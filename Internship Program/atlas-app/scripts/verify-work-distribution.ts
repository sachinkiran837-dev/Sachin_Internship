/**
 * Verifies Phase 2's Module C additions (C1 centralization footprint, C2
 * duplication detection, C3 back-office benchmarks, C4 productivity ratios)
 * against a synthetic multi-site establishment — the only seed file in this
 * repo that carries a Site column, since neither existing seed establishment
 * has one.
 *
 * Runs in memory. No database, no network, no key.
 *
 * Run with `npx tsx scripts/verify-work-distribution.ts`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseEstablishmentFile } from "../lib/ingest/parseFile";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { computeMetrics } from "../lib/metrics/diagnostics";
import { analyseFunctions } from "../lib/analysis/functions";
import { buildFootprint } from "../lib/analysis/footprint";
import { findDuplicatedFunctions } from "../lib/analysis/duplication";
import { benchmarkFunctions } from "../lib/analysis/backOfficeBenchmarks";
import { computeProductivity } from "../lib/analysis/productivity";
import { buildHypotheses } from "../lib/hypothesis/build";
import { EMPTY_BUSINESS, type BusinessContext } from "../lib/hypothesis/context";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function main() {
  const buffer = await readFile(
    path.join(process.cwd(), "db", "seed-data", "meridian-multisite-establishment.csv")
  );
  const parsed = parseEstablishmentFile("meridian-multisite-establishment.csv", buffer);
  const { positions } = await buildOrgGraph(parsed, { orgId: "verify-work-distribution", anonymize: false });
  const rootId = positions.find((p) => p.managerId === null)?.id ?? null;
  assert(rootId !== null, "expected a resolved root");

  const expectedClinical = parsed.rows.filter((r) =>
    /nurse/i.test(r["Position Title"] ?? "")
  ).length;

  /* ---------------------------------------------------------------- */
  console.log("1. C1 — the site column is read, and Finance/People foot-print across sites while Technology doesn't");

  const footprint = buildFootprint(positions, rootId);
  assert(
    footprint.clinicalExcludedCount === expectedClinical,
    `expected ${expectedClinical} clinical positions excluded from the footprint, got ${footprint.clinicalExcludedCount}`
  );

  const finance = footprint.functions.find((f) => f.functionGroup === "Finance")!;
  assert(finance, "expected a Finance function in the footprint");
  assert(finance.hasSiteData, "Finance carries a site value on every position and should read hasSiteData");
  assert(finance.bySite.length === 4, `expected 4 Finance site instances (Head Office + 3 campuses), got ${finance.bySite.length}`);
  assert(finance.archetype === "transactional", `expected Finance classified transactional, got ${finance.archetype}`);
  assert(finance.recommendedPattern === "shared service plus business partner", `expected a shared-service recommendation, got ${finance.recommendedPattern}`);
  console.log(`   Finance: ${finance.bySite.length} site instances, archetype ${finance.archetype}, pattern → ${finance.recommendedPattern}`);

  const tech = footprint.functions.find((f) => f.functionGroup === "Technology")!;
  assert(tech, "expected a Technology function in the footprint");
  assert(tech.bySite.length === 1, `Technology only exists at Head Office — expected 1 instance, got ${tech.bySite.length}`);
  assert(tech.recommendedPattern === null, "a single-instance function must skip the pattern recommendation");
  console.log(`   Technology: ${tech.bySite.length} site instance, pattern recommendation correctly skipped`);

  /* ---------------------------------------------------------------- */
  console.log("\n2. C2 — Finance and People duplicate for real; Operations doesn't (site-operational, and clinical is excluded regardless)");

  const duplicates = findDuplicatedFunctions(footprint);
  const financeDup = duplicates.find((d) => d.functionGroup === "Finance");
  assert(financeDup, "expected Finance to be flagged as duplicated");
  assert(financeDup!.instances.length === 3, `expected 3 qualifying Finance site instances (Head Office's single CFO doesn't qualify), got ${financeDup!.instances.length}`);
  assert(financeDup!.captureLow > 0 && financeDup!.captureHigh > financeDup!.captureLow, "expected a positive, ordered capture band");
  assert(financeDup!.protectedExcludedCount === 0, "no protected role sits inside a site Finance team in this fixture");
  console.log(`   Finance: ${financeDup!.instances.length} qualifying sites, ${financeDup!.combinedHeadcount} positions, capture band $${Math.round(financeDup!.captureLow).toLocaleString()}-$${Math.round(financeDup!.captureHigh).toLocaleString()}`);

  const peopleDup = duplicates.find((d) => d.functionGroup === "People");
  assert(peopleDup, "expected People to be flagged as duplicated (North and South both qualify; East carries no HR at all)");
  assert(peopleDup!.instances.length === 2, `expected 2 qualifying People site instances, got ${peopleDup!.instances.length}`);
  console.log(`   People: ${peopleDup!.instances.length} qualifying sites (East carries no HR presence at all)`);

  const opsDup = duplicates.find((d) => d.functionGroup === "Operations");
  assert(!opsDup, "Operations is site-operational and must never be priced as duplication");
  console.log("   Operations correctly excluded — site-operational archetype, and its clinical bulk is excluded outright");

  /* ---------------------------------------------------------------- */
  console.log("\n3. C3 — back-office bands read against an external reference, not this org's own median");

  const { primary: comparison } = analyseFunctions(positions, rootId, EMPTY_BUSINESS);
  const metrics = computeMetrics(positions, rootId);
  const commercial: BusinessContext = {
    ...EMPTY_BUSINESS,
    sector: "commercial professional services",
    revenue: [{ unit: null, amount: 40_000_000, period: "FY26", statedAs: "about $40m in FY26" }],
  };

  const readings = benchmarkFunctions(comparison, commercial, metrics.totalFte);
  const hr = readings.find((r) => r.functionGroup === "People")!;
  assert(hr, "expected a People/HR reading");
  assert(hr.bandKind === "fte-per-100", `expected People benchmarked FTE-per-100, got ${hr.bandKind}`);
  assert(["over", "in line", "under"].includes(hr.verdict), `expected a resolved HR verdict, got ${hr.verdict}`);
  console.log(`   People: ${hr.fteFor100.toFixed(2)} FTE/100 → ${hr.verdict} (${hr.bandStatement})`);

  const financeBand = readings.find((r) => r.functionGroup === "Finance")!;
  assert(financeBand.bandKind === "percent-of-revenue", `expected Finance benchmarked against revenue, got ${financeBand.bandKind}`);
  assert(["over", "in line", "under"].includes(financeBand.verdict), `expected a resolved Finance verdict now revenue is supplied, got ${financeBand.verdict}`);
  console.log(`   Finance: ${(financeBand.costShare * 100).toFixed(2)}% of revenue → ${financeBand.verdict}`);

  const techBand = readings.find((r) => r.functionGroup === "Technology")!;
  assert(techBand.verdict === "not computable", "Technology has no fixed band and must read not-computable, never a guessed verdict");
  console.log("   Technology: not computable, as specified — no fixed band exists to read it against");

  /* ---------------------------------------------------------------- */
  console.log("\n4. C4 — commercial and public-health instantiations, honest about what can't be computed");

  const commercialRead = computeProductivity(metrics, commercial);
  assert(commercialRead.instantiation === "commercial", "expected the commercial instantiation");
  assert(commercialRead.revenuePerFte !== null, "expected a revenue-per-FTE reading once revenue is supplied");
  assert(commercialRead.activityComputable === false && commercialRead.trendComputable === false, "this build has no activity or longitudinal data — both must read false");
  console.log(`   Commercial: revenue per FTE = $${Math.round(commercialRead.revenuePerFte!).toLocaleString()}`);

  const publicHealth: BusinessContext = { ...EMPTY_BUSINESS, sector: "public hospital network" };
  const publicHealthRead = computeProductivity(metrics, publicHealth);
  assert(publicHealthRead.instantiation === "public-health", "expected the public-health instantiation from the sector sentence");
  assert(publicHealthRead.revenuePerFte === null, "public-health path must not report a commercial ratio");
  assert(publicHealthRead.clinicalFte === metrics.clinicalFte && publicHealthRead.clinicalFte > 0, "expected clinical FTE carried through from A2/B1's tagging");
  console.log(`   Public-health: ${publicHealthRead.clinicalFte} clinical FTE visible; activity-per-clinical-FTE correctly not computable (no driver data ingested)`);

  /* ---------------------------------------------------------------- */
  console.log("\n5. Wired into the hypothesis engine end to end");

  const { hypotheses } = buildHypotheses(positions, rootId, commercial);
  assert(hypotheses.some((h) => h.id.startsWith("centralization:")), "expected a C1 centralization hypothesis");
  assert(hypotheses.some((h) => h.id.startsWith("duplication:")), "expected a C2 duplication hypothesis");
  assert(hypotheses.some((h) => h.id === "productivity:org-wide"), "expected the C4 revenue-per-FTE hypothesis");
  console.log(`   ${hypotheses.length} hypotheses generated, including Module C findings`);

  console.log("\nverify-work-distribution PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
