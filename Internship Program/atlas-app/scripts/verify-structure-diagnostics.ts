/**
 * Verifies the Phase 1 structure diagnostics (A2 roster/span separation, A3
 * cost foundations, B1 archetype-aware spans, B2 layer bands, B3 single-report
 * concentration, B4 shape, B5 hygiene) against the Meridian demo establishment.
 *
 * Run with `npx tsx scripts/verify-structure-diagnostics.ts`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseEstablishmentFile } from "../lib/ingest/parseFile";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { computeMetrics } from "../lib/metrics/diagnostics";
import { tagNodes } from "../lib/graph/tagging";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function main() {
  const buffer = await readFile(
    path.join(process.cwd(), "db", "seed-data", "meridian-full-establishment.csv")
  );
  const parsed = parseEstablishmentFile("meridian-full-establishment.csv", buffer);
  const { positions } = await buildOrgGraph(parsed, { orgId: "verify-structure", anonymize: true });
  const rootId = positions.find((p) => p.managerId === null)?.id ?? null;

  const tagged = tagNodes(positions, rootId);
  const byId = new Map(tagged.map((n) => [n.id, n] as const));
  const metrics = computeMetrics(positions, rootId);

  /* ---------------------------------------------------------------- */
  console.log("1. A2 — a manager staffing a clinical/frontline roster is exempt from span-health flagging");

  const managers = tagged.filter((n) => !n.synthetic && n.childIds.length > 0);
  const widest = [...managers].sort((a, b) => b.childIds.length - a.childIds.length)[0];
  assert(widest, "expected at least one manager in the demo establishment");

  const reports = widest.childIds.map((id) => byId.get(id)!);
  const clinicalShare = reports.filter((r) => r.clinicalFlag).length / reports.length;
  console.log(
    `   Widest span: "${widest.title}" — ${widest.childIds.length} reports, ${(clinicalShare * 100).toFixed(0)}% clinical, ` +
      `spanHealth=${widest.flags.spanHealth}, unitRoster=${widest.flags.unitRoster}`
  );
  if (widest.childIds.length >= 6 && clinicalShare >= 0.5) {
    assert(widest.flags.unitRoster, `"${widest.title}" has a ${widest.childIds.length}-strong clinical roster and should be tagged unitRoster`);
    assert(widest.flags.spanHealth === "healthy", `"${widest.title}" is a roster lead and must not be flagged thin/wide`);
  }

  /* ---------------------------------------------------------------- */
  console.log("\n2. B1 — every manager is classified into a span archetype, and the breakdown reconciles");

  for (const m of managers) {
    assert(m.flags.spanArchetype, `manager "${m.title}" has no spanArchetype tag`);
  }
  const archetypeTotal = metrics.spanByArchetype.reduce((s, a) => s + a.count, 0);
  assert(
    archetypeTotal === managers.length,
    `spanByArchetype covers ${archetypeTotal} managers but there are ${managers.length}`
  );
  for (const a of metrics.spanByArchetype) {
    assert(
      a.thinCount + a.healthyCount + a.wideCount === a.count,
      `${a.label}: thin+healthy+wide must equal the archetype's total count`
    );
  }
  console.log(`   ${metrics.spanByArchetype.map((a) => `${a.label}: ${a.count}`).join(", ")}`);

  /* ---------------------------------------------------------------- */
  console.log("\n3. B2 — the layer band verdict is computed and consistent with the raw layer count");

  assert(metrics.layerBand.layers === metrics.layers, "layerBand.layers must equal metrics.layers");
  assert(
    ["in-band", "over-band", "under-band"].includes(metrics.layerBand.verdict),
    "layerBand.verdict must be one of the three known values"
  );
  console.log(
    `   ${metrics.layers} layers vs band ${metrics.layerBand.healthyMin}-${metrics.layerBand.healthyMax} (flag above ${metrics.layerBand.flagAbove}) → ${metrics.layerBand.verdict}`
  );

  /* ---------------------------------------------------------------- */
  console.log("\n4. B3 — single-report cost and by-function concentration reconcile to the flagged nodes");

  const singleReportNodes = tagged.filter((n) => !n.synthetic && n.flags.singleReport);
  const expectedCost = singleReportNodes.reduce((s, n) => s + n.cost * n.fte, 0);
  assert(
    Math.abs(metrics.singleReportCost - expectedCost) < 1,
    `singleReportCost (${metrics.singleReportCost}) must equal the sum of single-report nodes' cost (${expectedCost})`
  );
  const concentrationTotal = metrics.singleReportByFunction.reduce((s, f) => s + f.count, 0);
  assert(
    concentrationTotal === singleReportNodes.length,
    `singleReportByFunction covers ${concentrationTotal} but there are ${singleReportNodes.length} single-report nodes`
  );
  console.log(
    `   ${singleReportNodes.length} single-report managers, ${metrics.singleReportByFunction.length} function group(s), reconciling`
  );

  /* ---------------------------------------------------------------- */
  console.log("\n5. B4 — shape classification is one of the known values, and layer totals reconcile");

  assert(
    ["pyramid", "diamond", "hourglass", "indeterminate"].includes(metrics.shape.shape),
    "shape must be one of the four known values"
  );
  const byLayerTotal = metrics.shape.byLayer.reduce((s, l) => s + l.headcount, 0);
  assert(byLayerTotal === metrics.headcount, `shape.byLayer covers ${byLayerTotal} but headcount is ${metrics.headcount}`);
  console.log(`   Shape: ${metrics.shape.shape}, management cost share ${(metrics.shape.managerCostShare * 100).toFixed(0)}%`);

  /* ---------------------------------------------------------------- */
  console.log("\n6. B5 — hygiene metrics are non-negative and computed");

  assert(metrics.hygiene.orphanCount >= 0, "orphanCount must be non-negative");
  assert(metrics.hygiene.coordinatorCount >= 0, "coordinatorCount must be non-negative");
  assert(metrics.hygiene.supportRatio >= 0 && metrics.hygiene.supportRatio <= 1, "supportRatio must be a fraction");
  console.log(
    `   ${metrics.hygiene.orphanCount} orphan issue(s), ${metrics.hygiene.coordinatorCount} coordinator title(s), ${(metrics.hygiene.supportRatio * 100).toFixed(1)}% support ratio`
  );

  /* ---------------------------------------------------------------- */
  console.log("\n7. A3 — fully-loaded cost is strictly above base cost wherever on-costs apply");

  assert(
    metrics.totalCostFullyLoaded > metrics.totalCost,
    "fully-loaded total must exceed the base total once on-costs are applied"
  );
  console.log(
    `   Base ${metrics.totalCost.toFixed(0)} → fully loaded ${metrics.totalCostFullyLoaded.toFixed(0)}; ${metrics.unpricedCount} unpriced position(s), ${metrics.unpricedEstimatedCost.toFixed(0)} estimated`
  );

  console.log("\nverify-structure-diagnostics PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
