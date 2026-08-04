/**
 * Verifies Phase 3's Module D (D1 contingent reliance, D2 vacancy hygiene,
 * D3 workforce mix) and Module E (E1 hardening, E2 key-person risk, E3
 * IR/EBA overlay) additions against a synthetic fixture built specifically
 * to exercise them — grade, start-date and vacancy-date columns that
 * neither existing seed establishment carries.
 *
 * Runs in memory. No database, no network, no key.
 *
 * Run with `npx tsx scripts/verify-workforce-risk.ts`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseEstablishmentFile } from "../lib/ingest/parseFile";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { computeMetrics } from "../lib/metrics/diagnostics";
import { analyseFunctions } from "../lib/analysis/functions";
import { tagNodes } from "../lib/graph/tagging";
import { buildVacancyHygiene } from "../lib/analysis/vacancyHygiene";
import { buildContingentReliance } from "../lib/analysis/contingentReliance";
import { buildWorkforceMix } from "../lib/analysis/workforceMix";
import { buildKeyPersonRisk } from "../lib/analysis/keyPersonRisk";
import { mapAwardCoverage, computeTransitionCost, computeScenarioIrReading } from "../lib/analysis/irEbaOverlay";
import { buildHypotheses } from "../lib/hypothesis/build";
import { EMPTY_BUSINESS } from "../lib/hypothesis/context";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function main() {
  const buffer = await readFile(
    path.join(process.cwd(), "db", "seed-data", "meridian-workforce-risk-establishment.csv")
  );
  const parsed = parseEstablishmentFile("meridian-workforce-risk-establishment.csv", buffer);
  const { positions } = await buildOrgGraph(parsed, { orgId: "verify-workforce-risk", anonymize: false });
  const rootId = positions.find((p) => p.managerId === null)?.id ?? null;
  assert(rootId !== null, "expected a resolved root");

  const tagged = tagNodes(positions, rootId);
  const byTitle = new Map(tagged.map((n) => [n.title, n] as const));

  /* ---------------------------------------------------------------- */
  console.log("1. E1 — roster auto-hold, and a control gap the register itself names");

  const num = byTitle.get("Nurse Unit Manager")!;
  assert(num.flags.unitRoster, "Nurse Unit Manager should read as a roster lead (6 reports, all clinical)");
  assert(num.flags.protected?.ruleId === "auto-hold-roster-lead", `expected NUM held by the roster auto-hold, got ${num.flags.protected?.ruleId}`);
  console.log(`   Nurse Unit Manager held via "${num.flags.protected!.instrument}" — no title-rule match needed`);

  const metrics = computeMetrics(positions, rootId);
  const gapIds = metrics.controlGaps.map((g) => g.id).sort();
  assert(
    gapIds.includes("clinical-director") && gapIds.includes("public-officer"),
    `expected clinical-director and public-officer as control gaps, got ${gapIds.join(", ")}`
  );
  assert(!gapIds.includes("safety-officer"), "Chief Safety Officer exists (vacant) — safety-officer must not read as a gap");
  console.log(`   Control gaps: ${gapIds.join(", ")} — exactly the two unmatched rules in this fixture`);

  const totalProtectedByDirectorate = metrics.protectedByDirectorate.reduce((s, d) => s + d.count, 0);
  assert(totalProtectedByDirectorate === metrics.protectedCount, "protectedByDirectorate must reconcile to protectedCount");
  console.log(`   ${metrics.protectedByDirectorate.length} directorate(s) carrying held roles, reconciling to ${metrics.protectedCount}`);

  /* ---------------------------------------------------------------- */
  console.log("\n2. E2 — sole incumbents, unique classifications and tenure cliffs, correctly triaged");

  const keyPerson = buildKeyPersonRisk(positions, rootId);
  const byId = new Map(keyPerson.flagged.map((f) => [f.id, f] as const));

  const numFlag = byId.get(num.id);
  assert(numFlag?.triage === "protect", `NUM is E1-protected, so triage must be "protect", got ${numFlag?.triage}`);
  assert(numFlag.reasons.includes("unique-classification"), "NUM's grade (Clinical1) is unique org-wide");

  const coo = byTitle.get("Chief Operating Officer")!;
  const cooFlag = byId.get(coo.id);
  assert(cooFlag?.triage === "succession-plan", `COO has no E1 hold, so triage must be "succession-plan", got ${cooFlag?.triage}`);
  assert(cooFlag.reasons.includes("tenure-cliff"), "COO has been in role since 2010 — well past the tenure-cliff threshold");

  const hrp = byTitle.get("HR Business Partner")!;
  const hrpFlag = byId.get(hrp.id);
  assert(hrpFlag, "HR Business Partner holds a unique grade and should be flagged");
  assert(
    hrpFlag.reasons.length === 1 && hrpFlag.reasons[0] === "unique-classification",
    `HR Business Partner has no reports and isn't protected, so only unique-classification should fire, got ${hrpFlag.reasons.join(",")}`
  );

  const cso = byTitle.get("Chief Safety Officer")!;
  assert(!byId.has(cso.id), "a vacant position has no incumbent and must never itself be flagged key-person");
  console.log(`   ${keyPerson.flagged.length} flagged: NUM → protect, COO → succession-plan, HR Business Partner → succession-plan (unique-classification only)`);

  /* ---------------------------------------------------------------- */
  console.log("\n3. D2 — vacancy readings: latent saving, recruitment failure, agency-papered gap, control gap");

  const { primary: comparison } = analyseFunctions(positions, rootId, EMPTY_BUSINESS);
  const agencyShareByUnit = new Map(comparison.units.map((u) => [u.key, u.agencyShare] as const));
  const vacancy = buildVacancyHygiene(positions, rootId, agencyShareByUnit);
  const readingOf = (title: string) => vacancy.longVacant.find((v) => v.title === title)?.reading;

  assert(readingOf("Business Systems Analyst") === "latent-saving", `expected latent-saving, got ${readingOf("Business Systems Analyst")}`);
  assert(readingOf("Recruitment Officer") === "recruitment-failure", `expected recruitment-failure, got ${readingOf("Recruitment Officer")}`);
  assert(readingOf("Logistics Coordinator") === "agency-papered-gap", `expected agency-papered-gap, got ${readingOf("Logistics Coordinator")}`);
  assert(readingOf("Chief Safety Officer") === "control-gap", `expected control-gap, got ${readingOf("Chief Safety Officer")}`);
  assert(vacancy.ageUnknownCount >= 1, "Business Analyst carries no vacancy date and should count toward ageUnknownCount");
  console.log(`   ${vacancy.longVacant.length} long-vacant positions read correctly; ${vacancy.ageUnknownCount} of unknown age`);

  /* ---------------------------------------------------------------- */
  console.log("\n4. D1 — Operations reads structural agency reliance, with a priced premium");

  const reliance = buildContingentReliance(positions, rootId, comparison, vacancy);
  const ops = reliance.byShare.find((u) => u.functionGroup === "Operations");
  assert(ops, "expected an Operations reading");
  assert(ops!.verdict === "structural", `expected Operations to read structural (>15%), got ${ops!.verdict} at ${(ops!.agencyShare * 100).toFixed(1)}%`);
  assert(ops!.premium > 0, "expected a positive premium — 3 contract Logistics Officers priced above the 2 permanent ones");
  console.log(`   Operations: ${(ops!.agencyShare * 100).toFixed(1)}% agency → ${ops!.verdict}, premium $${Math.round(ops!.premium).toLocaleString()}`);

  /* ---------------------------------------------------------------- */
  console.log("\n5. D3 — classification drift read against a same-function peer, never the whole org");

  const mix = buildWorkforceMix(positions, rootId);
  const groupFinance = mix.byUnit.find((u) => u.department === "Group Finance")!;
  const regionalFinance = mix.byUnit.find((u) => u.department === "Regional Finance")!;
  assert(groupFinance.seniorShare! > 0.7, `expected Group Finance senior share > 70%, got ${(groupFinance.seniorShare! * 100).toFixed(0)}%`);
  assert(
    Math.abs(groupFinance.peerMedianSeniorShare! - regionalFinance.seniorShare!) < 0.001,
    "Group Finance's only peer in the Finance function is Regional Finance — the comparator must be exactly its share"
  );
  assert(regionalFinance.fragmentationCount === 2, `expected 2 small-fraction positions in Regional Finance, got ${regionalFinance.fragmentationCount}`);
  console.log(`   Group Finance ${(groupFinance.seniorShare! * 100).toFixed(0)}% senior vs peer median ${(groupFinance.peerMedianSeniorShare! * 100).toFixed(0)}% — same-function comparator, not org-wide`);

  /* ---------------------------------------------------------------- */
  console.log("\n6. E3 — NES transition-cost floor, unmapped award coverage, consultation trigger");

  const coverage = mapAwardCoverage(positions);
  assert(coverage.every((c) => !c.mapped), "config/award-coverage.json is empty — every classification must read unmapped");

  const cooTransition = computeTransitionCost(coo);
  assert(cooTransition.tenureYears !== null && cooTransition.tenureYears > 15, "COO's tenure should read well past 15 years");
  assert(cooTransition.redundancyWeeks === 12, `expected the 10+-year NES redundancy figure of 12 weeks, got ${cooTransition.redundancyWeeks}`);
  assert(cooTransition.noticeWeeks === 4, `expected the 5+-year NES notice figure of 4 weeks, got ${cooTransition.noticeWeeks}`);

  const irReading = computeScenarioIrReading(positions, positions.filter((p) => p.id !== coo.id), [coo]);
  assert(irReading.consultationRequired, "removing a role must trigger the consultation flag");
  assert(irReading.totalTransitionCost > 0, "expected a positive transition cost for the removed role");
  assert(irReading.standingCaveat.includes("not a cashable saving"), "the standing caveat text must be attached verbatim");
  console.log(`   COO transition cost (NES floor): ${cooTransition.noticeWeeks}+${cooTransition.redundancyWeeks} weeks, consultation flagged`);

  /* ---------------------------------------------------------------- */
  console.log("\n7. Wired into the hypothesis engine end to end");

  const { hypotheses } = buildHypotheses(positions, rootId, EMPTY_BUSINESS);
  assert(hypotheses.some((h) => h.id.startsWith("contingent-reliance:")), "expected a D1 hypothesis");
  assert(hypotheses.some((h) => h.id === "vacancy-hygiene:long-vacant"), "expected a D2 hypothesis");
  assert(hypotheses.some((h) => h.id.startsWith("workforce-mix:")), "expected a D3 hypothesis");
  assert(hypotheses.some((h) => h.id === "key-person-risk:overview"), "expected an E2 hypothesis");
  console.log(`   ${hypotheses.length} hypotheses generated, including Module D/E findings`);

  console.log("\nverify-workforce-risk PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
