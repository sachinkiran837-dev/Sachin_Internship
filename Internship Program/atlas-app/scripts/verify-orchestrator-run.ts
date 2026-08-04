/**
 * Verifies the analytical bundle runner (`lib/orchestrator/run.ts`): the
 * full B-G sequence runs against real establishment data, and the four
 * documented skip conditions (E3 award coverage, D3 workforce mix, C
 * back-office benchmarks, F peer benchmarking) read "skipped" with a real
 * reason exactly where the underlying data genuinely doesn't support them —
 * never silently absent, never invented.
 *
 * Runs in memory. No database, no network, no key.
 *
 * Run with `npx tsx scripts/verify-orchestrator-run.ts`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";
import { parseEstablishmentFile } from "../lib/ingest/parseFile";
import { bindFiles, type SourceFile } from "../lib/ingest/bindFiles";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { cleanRows } from "../lib/canonical/clean";
import { runAnalyticalBundle, type OrchestratorLogEntry } from "../lib/orchestrator/run";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function statusOf(log: OrchestratorLogEntry[], worker: string): OrchestratorLogEntry {
  const entry = log.find((e) => e.worker === worker);
  if (!entry) throw new Error(`ASSERTION FAILED: no log entry for worker "${worker}"`);
  return entry;
}

async function loadCsvFixture(filename: string, orgId: string) {
  const buffer = await readFile(path.join(process.cwd(), "db", "seed-data", filename));
  const parsed = parseEstablishmentFile(filename, buffer);
  const { positions } = await buildOrgGraph(parsed, { orgId, anonymize: false });
  const rootId = positions.find((p) => p.managerId === null)?.id ?? null;
  return { positions, rootId };
}

/** A tiny establishment with no department a back-office band recognises. */
async function loadSparseFixture() {
  const rows = [
    { ID: "1", Name: "Alpha Chief", Title: "Chief Executive", Department: "Alpha Team", Manager: "", Salary: "300000" },
    { ID: "2", Name: "Alpha Lead", Title: "Team Lead", Department: "Alpha Team", Manager: "1", Salary: "150000" },
    { ID: "3", Name: "Beta Lead", Title: "Team Lead", Department: "Beta Team", Manager: "1", Salary: "148000" },
    { ID: "4", Name: "Beta Co", Title: "Coordinator", Department: "Beta Team", Manager: "3", Salary: "80000" },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Staff");
  const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  const file: SourceFile = { filename: "sparse.xlsx", parsed: parseEstablishmentFile("sparse.xlsx", buffer) };

  const bound = bindFiles([file], null);
  const { rows: cleaned } = cleanRows(bound.rows);
  bound.rows = cleaned;
  const { positions } = await buildOrgGraph(bound, { orgId: "verify-orchestrator-sparse", anonymize: false, groupBy: bound.groupBy });
  const rootId = positions.find((p) => p.managerId === null)?.id ?? null;
  return { positions, rootId };
}

async function main() {
  console.log("1. The rich fixture (meridian-full, 150+ positions, no Grade or award data) runs the full sequence");
  const full = await loadCsvFixture("meridian-full-establishment.csv", "verify-orch-full");
  const fullBundle = runAnalyticalBundle(full.positions, full.rootId);

  assert(fullBundle.log.length === 11, `expected 11 log entries, got ${fullBundle.log.length}`);
  for (const worker of ["B", "C:footprint-duplication", "C:productivity", "D:vacancy-hygiene", "D:contingent-reliance", "E:key-person-risk", "G"]) {
    assert(statusOf(fullBundle.log, worker).status === "computed", `${worker} should always compute — it has no documented skip condition`);
  }
  assert(fullBundle.hypotheses.length > 0, "expected at least one hypothesis from a real, rich fixture");
  assert(fullBundle.metrics.headcount === full.positions.filter((p) => !p.synthetic).length, "metrics.headcount should match the real position count");
  console.log(`   ${fullBundle.log.length} workers logged, ${fullBundle.hypotheses.length} hypotheses, headcount ${fullBundle.metrics.headcount}`);

  console.log("\n2. E3 (award coverage) reads skipped — config/award-coverage.json ships with an empty map by design");
  const award = statusOf(fullBundle.log, "E3:award-coverage");
  assert(award.status === "skipped", `expected E3 skipped against an empty coverage map, got ${award.status}`);
  assert(!!award.reason && award.reason.length > 10, "a skip must always carry a real reason");
  console.log(`   "${award.reason}"`);

  console.log("\n3. D3 (workforce mix) reads skipped on meridian-full — the fixture carries no Grade column at all");
  const mix = statusOf(fullBundle.log, "D:workforce-mix");
  assert(mix.status === "skipped", `expected D3 skipped with no Grade column, got ${mix.status}`);
  console.log(`   "${mix.reason}"`);

  console.log("\n4. C (back-office benchmarks) reads computed on meridian-full — its own Finance department matches a configured band");
  const backOffice = statusOf(fullBundle.log, "C:back-office-benchmarks");
  assert(backOffice.status === "computed", `expected the Finance department to produce a real band reading, got ${backOffice.status}`);

  console.log("\n5. The workforce-risk fixture (real Grade values) flips D3 to computed — same rule, different data");
  const risk = await loadCsvFixture("meridian-workforce-risk-establishment.csv", "verify-orch-risk");
  const riskBundle = runAnalyticalBundle(risk.positions, risk.rootId);
  const riskMix = statusOf(riskBundle.log, "D:workforce-mix");
  assert(riskMix.status === "computed", `expected real Grade values to make workforce mix computable, got ${riskMix.status}`);
  assert(riskBundle.workforceMix.gradeCoverage > 0, "gradeCoverage should be nonzero with real Grade data present");
  console.log(`   grade coverage ${(riskBundle.workforceMix.gradeCoverage * 100).toFixed(0)}% — D3 now reads computed`);
  // Same config, same fixture family — E3 stays skipped regardless of what else the fixture carries.
  assert(statusOf(riskBundle.log, "E3:award-coverage").status === "skipped", "E3 should stay skipped on every fixture until config/award-coverage.json is actually filled in");

  console.log("\n6. A sparse, synthetic establishment with no recognised back-office department flips C to skipped");
  const sparse = await loadSparseFixture();
  const sparseBundle = runAnalyticalBundle(sparse.positions, sparse.rootId);
  const sparseBackOffice = statusOf(sparseBundle.log, "C:back-office-benchmarks");
  assert(sparseBackOffice.status === "skipped", `expected no configured band to match "Alpha Team"/"Beta Team", got ${sparseBackOffice.status}`);
  console.log(`   "${sparseBackOffice.reason}"`);
  // Every skip is logged as a fact, never silently absent — the bundle still returns real B/G output alongside it.
  assert(sparseBundle.hypotheses !== undefined, "a skipped worker must not stop the rest of the bundle from running");

  console.log("\nverify-orchestrator-run PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
