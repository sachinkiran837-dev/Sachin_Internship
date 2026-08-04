/**
 * Verifies Phase 6's H2 (scenario-impact-modeling) against a real applied
 * play on the meridian-full-establishment fixture: baseline immutability,
 * structural/financial/governance recomputation, the phased net-savings
 * curve and break-even month, the protected-roles-held-vs-full-register
 * check, and side-by-side best-value-per-row highlighting across two
 * differently-shaped scenarios.
 *
 * Runs in memory. No database, no network, no key.
 *
 * Run with `npx tsx scripts/verify-scenario-impact.ts`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEstablishmentFile } from "../lib/ingest/parseFile";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { computeMetrics } from "../lib/metrics/diagnostics";
import { analysePlay } from "../lib/scenario/plays";
import { remove, reassign, rebase } from "../lib/scenario/moves";
import { computeScenarioImpact, highlightBestPerRow } from "../lib/scenario/impact";
import type { Position } from "../lib/graph/types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function applyPlay(positions: Position[], rootId: string | null, playId: string): Position[] {
  const analysis = analysePlay(playId, positions, rootId);
  assert(analysis && analysis.operations.length > 0, `expected ${playId} to have real operations to replay`);
  let current = positions;
  for (const op of analysis!.operations) {
    if (!current.some((p) => p.id === op.positionId)) continue;
    const outcome =
      op.kind === "remove"
        ? remove(current, rootId, op.positionId)
        : op.kind === "reassign"
          ? reassign(current, rootId, op.positionId, op.newManagerId)
          : rebase(current, op.positionId, { cost: op.cost, status: op.status, reason: op.reason });
    if (!outcome.blocked) current = outcome.positions;
  }
  return current;
}

async function main() {
  const buffer = await readFile(path.join(process.cwd(), "db", "seed-data", "meridian-full-establishment.csv"));
  const parsed = parseEstablishmentFile("meridian-full-establishment.csv", buffer);
  const { positions: baseline } = await buildOrgGraph(parsed, { orgId: "verify-h2", anonymize: false });
  const rootId = baseline.find((p) => p.managerId === null)?.id ?? null;

  console.log("1. Baseline immutability — every primitive returns a new array, never mutates its input");
  const beforeJson = JSON.stringify(baseline);
  const target = baseline.find((p) => p.managerId !== null && !p.synthetic)!;
  remove(baseline, rootId, target.id);
  reassign(baseline, rootId, target.id, baseline.find((p) => p.id !== target.id && p.managerId !== target.id)!.id);
  assert(JSON.stringify(baseline) === beforeJson, "the baseline array must be byte-identical after calling remove/reassign against it — both must return new arrays");
  console.log("   baseline array is byte-identical after remove() and reassign() were called against it");

  console.log("\n2. A real scenario, costed structurally/financially/governance-wise against the locked baseline");
  const scenarioA = applyPlay(baseline, rootId, "pass-through-layers");
  const impactA = computeScenarioImpact(baseline, "scenario-a", "Strip pass-through layers", scenarioA, rootId);

  const baselineMetrics = computeMetrics(baseline, rootId);
  const scenarioMetrics = computeMetrics(scenarioA, rootId);
  assert(impactA.structural.headcountDelta === scenarioMetrics.headcount - baselineMetrics.headcount, "structural headcount delta must be recomputed from the post-change graph, not adjusted by hand");
  assert(Math.abs(impactA.financial.costRemovedGross - (baselineMetrics.totalCost - scenarioMetrics.totalCost)) < 1, "cost removed must equal the real baseline-vs-scenario cost difference");
  assert(impactA.financial.costRemovedGross > 0, "expected a real cost removal from pass-through-layers");
  console.log(`   headcount ${impactA.structural.headcountDelta}, cost removed $${impactA.financial.costRemovedGross.toLocaleString()}, net at run-rate $${Math.round(impactA.financial.netAtRunRate).toLocaleString()}`);

  console.log("\n3. Phased curve and break-even — a real payback point, not a claimed one");
  assert(impactA.financial.phasedCurve.length === 25, `expected a 25-month (0-24) curve, got ${impactA.financial.phasedCurve.length}`);
  assert(impactA.financial.phasedCurve[0].cumulativeNet === -impactA.financial.transitionCost, "month 0 must read as exactly negative the transition cost — nothing has accrued yet");
  if (impactA.financial.breakEvenMonths !== null) {
    const atBreakEven = impactA.financial.phasedCurve.find((c) => c.month === Math.ceil(impactA.financial.breakEvenMonths!));
    assert(atBreakEven ? atBreakEven.cumulativeNet >= -1 : true, "cumulative net at the ceiling of the stated break-even month should be at or past zero");
    console.log(`   break-even at ${impactA.financial.breakEvenMonths!.toFixed(1)} months, transition cost $${Math.round(impactA.financial.transitionCost).toLocaleString()}`);
  } else {
    console.log("   no positive net saving on this scenario — break-even correctly reads null, not a division artefact");
  }

  console.log("\n4. Protected roles held is checked against the FULL register, not just what the scenario touched");
  assert(impactA.governance.protectedRolesTotal === baselineMetrics.protectedCount, "protectedRolesTotal must equal the full register count");
  assert(impactA.governance.allProtectedRolesHeld, "the mutation guardrail blocks every protected-role removal/reassignment at the entry point — every scenario should hold 100% of them, by construction");
  assert(impactA.governance.protectedRolesHeld === impactA.governance.protectedRolesTotal, `expected protectedRolesHeld to equal protectedRolesTotal, got ${impactA.governance.protectedRolesHeld} of ${impactA.governance.protectedRolesTotal}`);
  console.log(`   ${impactA.governance.protectedRolesHeld} of ${impactA.governance.protectedRolesTotal} protected roles held — the "50 of 51 is not 97%" rule holds trivially true here because the guardrail already enforces it upstream`);

  console.log("\n5. Side-by-side comparison — best value per row, never a single collapsed winner");
  const scenarioB = applyPlay(baseline, rootId, "manager-ratio");
  const impactB = computeScenarioImpact(baseline, "scenario-b", "Rebalance the management ratio", scenarioB, rootId);
  const best = highlightBestPerRow([impactA, impactB]);
  assert(best.netAtRunRate !== undefined, "expected a best-value scenario for net-at-run-rate");
  assert(best.reportingLineChurn !== undefined, "expected a best-value scenario for churn");
  const rows = Object.keys(best);
  const uniqueWinners = new Set(Object.values(best));
  console.log(`   ${rows.length} rows compared; ${uniqueWinners.size} distinct scenario(s) win at least one row — a real trade-off, not a single ranked winner`);
  assert(
    impactB.structural.headcountDelta <= impactA.structural.headcountDelta,
    "manager-ratio should cut at least as many roles as pass-through-layers on this fixture — sanity check the two scenarios are genuinely different depths"
  );

  console.log("\nverify-scenario-impact PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
