/**
 * Verifies Phase 7's I1 (board-pack-synthesis) against the real
 * meridian-full-establishment fixture — the same one G2's reconciliation
 * was verified against, so the headline figure here can be cross-checked
 * directly against scripts/verify-value-sizing.ts's own numbers.
 *
 * Runs in memory. No database, no network, no key.
 *
 * Run with `npx tsx scripts/verify-board-pack.ts`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEstablishmentFile } from "../lib/ingest/parseFile";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { computeMetrics } from "../lib/metrics/diagnostics";
import { buildHypotheses } from "../lib/hypothesis/build";
import { buildBoardPack } from "../lib/report/boardPack";
import { EMPTY_BUSINESS } from "../lib/hypothesis/context";
import { analyseAllPlays } from "../lib/scenario/plays";
import { reconcileValue } from "../lib/scenario/reconcile";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function main() {
  const buffer = await readFile(path.join(process.cwd(), "db", "seed-data", "meridian-full-establishment.csv"));
  const parsed = parseEstablishmentFile("meridian-full-establishment.csv", buffer);
  const { positions } = await buildOrgGraph(parsed, { orgId: "verify-i1", anonymize: false });
  const rootId = positions.find((p) => p.managerId === null)?.id ?? null;

  const metrics = computeMetrics(positions, rootId);
  const { hypotheses } = buildHypotheses(positions, rootId, EMPTY_BUSINESS);
  const pack = buildBoardPack(positions, rootId, EMPTY_BUSINESS, metrics, hypotheses, true);

  console.log("1. The headline matches G2's own reconciled stack exactly — never re-rounded or restated");
  const independentReconciled = reconcileValue(positions, analyseAllPlays(positions, rootId));
  assert(pack.headlineAmount === independentReconciled.headline.netStack, `headline drift: pack ${pack.headlineAmount} vs reconcileValue ${independentReconciled.headline.netStack}`);
  assert(pack.judgmentSentence.length > 20, "expected a real judgment sentence, not a placeholder");
  console.log(`   headline $${Math.round(pack.headlineAmount).toLocaleString()} — bit-for-bit the same figure verify-value-sizing.ts checks`);

  console.log("\n2. No value tile mixes estimate classes");
  assert(pack.valueTiles.length > 0, "expected at least one value tile on a fixture with real priced plays");
  const classes = new Set(pack.valueTiles.map((t) => t.estimateClass));
  assert(classes.size === pack.valueTiles.length, "each estimate class must appear as at most one tile — no mixing");
  const tileSum = pack.valueTiles.reduce((s, t) => s + t.amount, 0);
  assert(Math.abs(tileSum - pack.headlineAmount) < 1, `tiles must sum to the headline: ${tileSum} vs ${pack.headlineAmount}`);
  console.log(`   ${pack.valueTiles.length} tile(s): ${pack.valueTiles.map((t) => `${t.estimateClass} $${Math.round(t.amount).toLocaleString()}`).join(", ")}`);

  console.log("\n3. Every hypothesis in Where the Value Is carries a confidence grade and at least one question");
  assert(pack.whereTheValueIs.length > 0, "expected real hypotheses on this fixture");
  for (const h of pack.whereTheValueIs) {
    assert(h.confidenceGrade, `${h.id} must carry a confidence grade to appear here`);
    assert((h.provokingQuestions?.length ?? 0) >= 1, `${h.id} must carry at least one provoking question`);
  }
  console.log(`   ${pack.whereTheValueIs.length} hypotheses shown, all graded, all carrying questions`);

  console.log("\n4. How You Compare never shows a not-computable reading, and bands are never a point estimate");
  for (const { reading } of pack.howYouCompare) {
    assert(reading.verdict !== "not computable", "a not-computable reading has nothing to compare — must be excluded from the board pack");
    assert(reading.bandMin !== null && reading.bandMax !== null, `${reading.metric}: a shown band verdict must carry its actual band, never an implied one`);
  }
  console.log(`   ${pack.howYouCompare.length} peer-benchmark verdict(s) shown, all with a real band position`);

  console.log("\n5. The protection story names the actual count, never a generic assurance");
  assert(pack.protectionStory.statement.includes(String(pack.protectionStory.totalHeld)), "the protection statement must name the real count, not a vague sentence");
  assert(pack.protectionStory.totalHeld === metrics.protectedCount, `protection story must reflect the current count: ${pack.protectionStory.totalHeld} vs ${metrics.protectedCount}`);
  console.log(`   "${pack.protectionStory.statement}"`);

  console.log("\n6. The standing caveat is fixed text, present, and attached to the pack's value statements");
  assert(pack.standingCaveat.includes("not a cashable saving"), "the standing caveat must be the fixed E3 text, not a rewritten summary");
  console.log("   standing caveat verbatim, present on the pack");

  console.log("\nverify-board-pack PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
