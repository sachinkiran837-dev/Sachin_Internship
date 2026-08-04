/**
 * Verifies Phase 6's H3 (implementation-phasing) against the real
 * meridian-full-establishment fixture: the sign-off gate withholding every
 * phase beyond validation, the fixed default sequence once signed off,
 * agency conversion landing last, and the sequence-level churn-budget check.
 *
 * Runs in memory. No database, no network, no key.
 *
 * Run with `npx tsx scripts/verify-phasing.ts`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEstablishmentFile } from "../lib/ingest/parseFile";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { buildPhaseLadder } from "../lib/scenario/phasing";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function main() {
  const buffer = await readFile(path.join(process.cwd(), "db", "seed-data", "meridian-full-establishment.csv"));
  const parsed = parseEstablishmentFile("meridian-full-establishment.csv", buffer);
  const { positions } = await buildOrgGraph(parsed, { orgId: "verify-h3", anonymize: false });
  const rootId = positions.find((p) => p.managerId === null)?.id ?? null;

  console.log("1. Without client sign-off, nothing beyond validation is scheduled");
  const unsigned = buildPhaseLadder(positions, rootId, false);
  assert(!unsigned.signOffConfirmed, "expected signOffConfirmed: false to propagate");
  const validatePhase = unsigned.phases.find((p) => p.id === "validate-register")!;
  assert(!validatePhase.withheld, "the validation phase itself must never be withheld — it's the gate, not behind it");
  const laterPhases = unsigned.phases.filter((p) => p.id !== "validate-register");
  assert(laterPhases.every((p) => p.withheld), "every phase beyond validation must read withheld until sign-off is confirmed");
  assert(laterPhases.every((p) => p.withheldReason?.includes("sign")), "every withheld phase must name the sign-off gate as the reason, not a generic block");
  console.log(`   ${laterPhases.length} phases correctly withheld pending sign-off, each naming the gate`);

  console.log("\n2. Once signed off, the fixed sequence runs — quick wins first, agency conversion last");
  const signed = buildPhaseLadder(positions, rootId, true);
  assert(signed.phases.length === 6, `expected 6 phases in the fixed sequence, got ${signed.phases.length}`);
  const order = signed.phases.map((p) => p.id);
  assert(
    order.indexOf("funded-vacant-quick-wins") < order.indexOf("management-consolidation") &&
      order.indexOf("management-consolidation") < order.indexOf("shared-service-build") &&
      order.indexOf("shared-service-build") < order.indexOf("agency-conversion"),
    `expected quick-wins -> consolidation -> shared-service -> agency-conversion, got ${order.join(" -> ")}`
  );
  console.log(`   sequence: ${order.join(" -> ")}`);

  console.log("\n3. Each phase sources its roles from exactly its own named plays, no mixing");
  const consolidation = signed.phases.find((p) => p.id === "management-consolidation")!;
  assert(
    consolidation.playIds.every((id) => ["pass-through-layers", "deep-chain-compression", "manager-ratio"].includes(id)),
    `management-consolidation must only draw from b2/b3 plays, got ${consolidation.playIds}`
  );
  const agency = signed.phases.find((p) => p.id === "agency-conversion")!;
  assert(agency.roleCount > 0, "expected real agency-conversion candidates on this fixture");
  assert(
    agency.playIds.every((id) => ["agency-premium", "contractor-insourcing"].includes(id)),
    "agency-conversion must only draw from d1 conversion plays"
  );
  console.log(`   management-consolidation: ${consolidation.roleCount} roles from [${consolidation.playIds.join(", ")}]; agency-conversion: ${agency.roleCount} roles from [${agency.playIds.join(", ")}]`);

  console.log("\n4. Each phase carries its own incremental contribution, not the running scenario total");
  const withCost = signed.phases.filter((p) => p.roleCount > 0);
  assert(withCost.length >= 2, "expected at least two phases with real candidates on this fixture to compare");
  const contributions = withCost.map((p) => p.incrementalNet);
  assert(
    new Set(contributions.map((c) => Math.round(c))).size > 1 || contributions.length < 2,
    "distinct phases with different candidate sets should generally show distinct incremental contributions, not all reading the same scenario-level total"
  );
  console.log(`   incremental net by phase: ${withCost.map((p) => `${p.label} $${Math.round(p.incrementalNet).toLocaleString()}`).join("; ")}`);

  console.log("\n5. Plays that found candidates but don't source a fixed phase are shown, not silently dropped");
  console.log(`   ungrouped: ${signed.ungroupedPlays.map((p) => p.playName).join(", ") || "(none on this fixture)"}`);

  console.log("\n6. The churn-budget check runs across the whole cumulative sequence");
  assert(typeof signed.churnBudget.cumulativeChurnRate === "number", "expected a real cumulative churn rate");
  assert(signed.churnBudget.budget > 0, "expected a real churn budget from config");
  console.log(`   cumulative churn ${(signed.churnBudget.cumulativeChurnRate * 100).toFixed(1)}% against a ${(signed.churnBudget.budget * 100).toFixed(0)}% budget — over budget: ${signed.churnBudget.overBudget}`);

  console.log("\nverify-phasing PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
