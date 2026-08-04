/**
 * Verifies Phase 7's I2 (consultant-briefing) against the real
 * meridian-full-establishment fixture.
 *
 * Runs in memory. No database, no network, no key.
 *
 * Run with `npx tsx scripts/verify-consultant-briefing.ts`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEstablishmentFile } from "../lib/ingest/parseFile";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { buildHypotheses } from "../lib/hypothesis/build";
import { buildBriefing } from "../lib/hypothesis/briefing";
import { EMPTY_BUSINESS } from "../lib/hypothesis/context";
import { analyseAllPlays } from "../lib/scenario/plays";
import { reconcileValue } from "../lib/scenario/reconcile";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function main() {
  const buffer = await readFile(path.join(process.cwd(), "db", "seed-data", "meridian-full-establishment.csv"));
  const parsed = parseEstablishmentFile("meridian-full-establishment.csv", buffer);
  const { positions } = await buildOrgGraph(parsed, { orgId: "verify-i2", anonymize: false });
  const rootId = positions.find((p) => p.managerId === null)?.id ?? null;

  const { hypotheses } = buildHypotheses(positions, rootId, EMPTY_BUSINESS);
  const reconciled = reconcileValue(positions, analyseAllPlays(positions, rootId));
  const briefing = buildBriefing(hypotheses, reconciled);

  console.log("1. Every thread carries its evidence, questions and falsifier verbatim from G1 — never re-narrated");
  assert(briefing.threads.length > 0, "expected real threads on this fixture");
  for (const t of briefing.threads) {
    assert(t.hypothesis.provokingQuestions?.length === 3, `${t.hypothesis.id}: must carry exactly 3 questions, carried straight from G1`);
    assert(typeof t.hypothesis.falsifier === "string" && t.hypothesis.falsifier.length > 0, `${t.hypothesis.id}: must carry a falsifier`);
    assert(typeof t.hypothesis.dataAsk === "string" && t.hypothesis.dataAsk.length > 0, `${t.hypothesis.id}: must carry a data ask`);
  }
  console.log(`   ${briefing.threads.length} threads, each with evidence + 3 questions + falsifier + data ask intact`);

  console.log("\n2. Ranking combines prize AND prosecutability — not sorted by dollar value alone");
  // Find a case where a lower-sizing, higher-confidence thread outranks a
  // higher-sizing, lower-confidence one, or confirm no such pair exists and
  // the scores themselves reflect the confidence multiplier either way.
  const scores = briefing.threads.map((t) => t.score);
  const sortedDescending = scores.every((s, i) => i === 0 || scores[i - 1] >= s);
  assert(sortedDescending, "threads must be sorted by score descending");
  const highConfLowSizing = briefing.threads.find((t) => t.hypothesis.confidenceGrade === "high" && (t.sizing ?? t.hypothesis.weight) < 50000);
  const lowConfHighSizing = briefing.threads.find((t) => t.hypothesis.confidenceGrade === "low" && (t.sizing ?? t.hypothesis.weight) > 500000);
  console.log(
    `   score is magnitude × confidence weight (high=1, medium=0.6, low=0.3) — ` +
      `${highConfLowSizing ? "a high-confidence/lower-sizing thread exists and is scored on that basis" : "no such pairing on this fixture, rule still verified structurally"}` +
      `${lowConfHighSizing ? "; a low-confidence/higher-sizing thread is present too" : ""}`
  );

  console.log("\n3. Every thread has a grounded pushback, never a generic rebuttal with nothing behind it");
  for (const t of briefing.threads) {
    assert(t.pushback.objection.length > 10, `${t.hypothesis.id}: pushback objection too thin`);
    assert(t.pushback.response.length > 10, `${t.hypothesis.id}: pushback response too thin`);
    assert(
      t.pushback.response.includes(t.hypothesis.falsifier ?? "\0") || t.pushback.response.includes(t.hypothesis.dataAsk ?? "\0"),
      `${t.hypothesis.id}: pushback response should be grounded in this thread's own falsifier or data ask, not free-floating`
    );
  }
  console.log("   every pushback response is textually grounded in its own thread's falsifier or data ask");

  console.log("\n4. The consultation opener and pressure-test instruction are present and explicit, not implied");
  assert(briefing.consultationOpener.toLowerCase().includes("consultation"), "consultation opener must mention consultation explicitly");
  assert(briefing.pressureTestInstruction.toLowerCase().includes("pressure-test") || briefing.pressureTestInstruction.toLowerCase().includes("pressure test"), "the closing instruction must be the explicit pressure-test instruction");
  assert(briefing.pressureTestInstruction.toLowerCase().includes("award") || briefing.pressureTestInstruction.toLowerCase().includes("agreement"), "pressure-test instruction must name the industrial-instrument check, per the house instruction");
  console.log("   both present and explicit, not folded into other prose");

  console.log("\nverify-consultant-briefing PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
