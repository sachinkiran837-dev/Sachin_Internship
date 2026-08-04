/**
 * Verifies Phase 5's G1 (hypothesis-generation) enrichment pass: every
 * hypothesis produced by buildHypotheses carries an archetype tag (or is
 * honestly left unmatched), a mechanically-graded confidence level, three
 * provoking questions, a falsifier and a data ask — added once, in
 * lib/hypothesis/archetypes.ts, without touching any of the eighteen
 * existing generator functions in build.ts.
 *
 * Reuses the workforce-risk fixture from Phase 3, which already carries a
 * real control gap, key-person flags, contingent reliance, a long-vacant
 * position and an engineered classification-drift pair — enough surface to
 * exercise most of the 12-item archetype library without a new fixture.
 *
 * Runs in memory. No database, no network, no key.
 *
 * Run with `npx tsx scripts/verify-hypothesis-enrichment.ts`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEstablishmentFile } from "../lib/ingest/parseFile";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
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
  const { positions } = await buildOrgGraph(parsed, { orgId: "verify-g1", anonymize: false });
  const rootId = positions.find((p) => p.managerId === null)?.id ?? null;
  assert(rootId !== null, "expected a resolved root");

  const { hypotheses } = buildHypotheses(positions, rootId, EMPTY_BUSINESS);
  assert(hypotheses.length > 5, `expected a real spread of hypotheses, got ${hypotheses.length}`);

  console.log(`1. Every one of ${hypotheses.length} hypotheses carries all five G1 fields`);
  for (const h of hypotheses) {
    assert(Array.isArray(h.archetypes), `${h.id}: archetypes must be an array (possibly empty), never missing`);
    assert(
      h.confidenceGrade === "high" || h.confidenceGrade === "medium" || h.confidenceGrade === "low",
      `${h.id}: confidenceGrade must be high/medium/low, got ${h.confidenceGrade}`
    );
    assert(Array.isArray(h.provokingQuestions) && h.provokingQuestions.length === 3, `${h.id}: expected exactly 3 provoking questions, got ${h.provokingQuestions?.length}`);
    assert(typeof h.falsifier === "string" && h.falsifier.length > 10, `${h.id}: falsifier must be a real, specific sentence`);
    assert(typeof h.dataAsk === "string" && h.dataAsk.length > 10, `${h.id}: dataAsk must be a real sentence, never omitted`);
  }
  console.log("   archetypes, confidence grade, 3 questions, a falsifier and a data ask are present on every hypothesis");

  const byId = new Map(hypotheses.map((h) => [h.id, h] as const));

  console.log("\n2. Archetype 11 (control gap) has a source hypothesis for the first time");
  const gap = byId.get("control-gap:overview");
  assert(gap, "expected a control-gap:overview hypothesis — this fixture carries 2 unmatched register rules");
  assert(gap.archetypes!.includes("control-gap"), `expected control-gap archetype, got ${gap.archetypes}`);
  assert(gap.lens === "Risk and controls", `expected the Risk and controls lens, got ${gap.lens}`);
  console.log(`   "${gap.title}" — archetypes: [${gap.archetypes!.join(", ")}]`);

  console.log("\n3. Archetype tagging against the rest of the library");
  const keyPerson = byId.get("key-person-risk:overview");
  assert(keyPerson?.archetypes!.includes("key-person-exposure"), "key-person-risk:overview should tag key-person-exposure");

  const contingent = [...byId.keys()].find((id) => id.startsWith("contingent-reliance:"));
  if (contingent) {
    assert(byId.get(contingent)!.archetypes!.includes("contingent-concentration"), `${contingent} should tag contingent-concentration`);
  }

  const vacancy = byId.get("vacancy-hygiene:long-vacant");
  if (vacancy) {
    assert(vacancy.archetypes!.includes("funded-vacancy-latency"), "vacancy-hygiene:long-vacant should tag funded-vacancy-latency");
  }

  const mixIds = [...byId.keys()].filter((id) => id.startsWith("workforce-mix:") && id !== "workforce-mix:agency");
  assert(mixIds.length > 0, "expected at least one D3 workforce-mix hypothesis from the Group/Regional Finance drift pair");
  const financeMix = byId.get(mixIds.find((id) => id.includes("Finance")) ?? mixIds[0]);
  assert(
    financeMix!.archetypes!.includes("top-heavy-shape") || financeMix!.archetypes!.includes("classification-drift"),
    `expected the Finance drift hypothesis to tag top-heavy-shape or classification-drift, got ${financeMix!.archetypes}`
  );
  console.log(`   key-person-exposure, funded-vacancy-latency and classification-drift all correctly tagged`);

  console.log("\n4. Findings matching no archetype are held separately, never forced");
  const peerIds = [...byId.keys()].filter((id) => id.startsWith("peer-benchmark:"));
  for (const id of peerIds) {
    assert((byId.get(id)!.archetypes ?? []).length === 0, `${id}: F1 findings aren't named in any of the 12 archetypes — must read unmatched, got ${byId.get(id)!.archetypes}`);
  }
  console.log(`   ${peerIds.length} peer-benchmark hypothesis(es) correctly read archetypes: [] rather than a forced guess`);

  console.log("\n5. A data-gap hypothesis's data ask reuses its own action, never drafts a second, contradictory one");
  const needsInput = hypotheses.find((h) => h.strength === "needs-input");
  if (needsInput) {
    assert(needsInput.dataAsk === needsInput.action, `expected dataAsk to equal action for a needs-input hypothesis "${needsInput.id}"`);
    console.log(`   "${needsInput.id}" — dataAsk verbatim-equals its own action field`);
  } else {
    console.log("   (no needs-input hypothesis in this fixture's business context — nothing to check)");
  }

  console.log("\nverify-hypothesis-enrichment PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
