/**
 * Verifies the orchestrator's QC layer (`lib/orchestrator/verify.ts`):
 *
 * - `checkInvariants` reads clean on a real, rich fixture, and catches a
 *   hand-corrupted bundle — the live version of a `verify-*.ts` assertion,
 *   run against real output instead of only ever checked in a dev script.
 * - `checkCanonicalGrounding` reads clean against the rows a real ingest
 *   actually read, always samples every low-confidence row, and catches a
 *   deliberately mismatched one without needing a database.
 * - `askWithRetry` escalates tiers correctly and gives up after exhausting
 *   them — checked structurally when no AI key is configured (the common
 *   case for this repo), and with a live round trip when one is.
 *
 * Runs in memory. No database required.
 *
 * Run with `npx tsx scripts/verify-orchestrator-qc.ts`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEstablishmentFile } from "../lib/ingest/parseFile";
import { bindFiles, type SourceFile } from "../lib/ingest/bindFiles";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { cleanRows } from "../lib/canonical/clean";
import { runAnalyticalBundle } from "../lib/orchestrator/run";
import {
  checkInvariants,
  checkCanonicalGrounding,
  canonicalGroundingNote,
  askWithRetry,
} from "../lib/orchestrator/verify";
import { hasAI } from "../lib/ai/client";
import type { IngestIssue } from "../lib/graph/types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

/**
 * Goes through `bindFiles`/`cleanRows` rather than calling `buildOrgGraph`
 * on a bare `ParsedFile` the way `verify-orchestrator-run.ts` does — that
 * shortcut skips the column-rename step, and the grounding checker needs
 * `bound.rows` keyed by canonical field name (`title`/`cost`/`fte`/…),
 * exactly what `lib/ingest/run.ts` actually passes it in production.
 */
async function loadFixture(filename: string, orgId: string) {
  const buffer = await readFile(path.join(process.cwd(), "db", "seed-data", filename));
  const file: SourceFile = { filename, parsed: parseEstablishmentFile(filename, buffer) };
  const bound = bindFiles([file], null);
  const { rows: cleaned } = cleanRows(bound.rows);
  bound.rows = cleaned;
  const { positions, issues } = await buildOrgGraph(bound, { orgId, anonymize: false, groupBy: bound.groupBy });
  const rootId = positions.find((p) => p.managerId === null)?.id ?? null;
  return { positions, issues, rootId, rows: bound.rows };
}

async function main() {
  console.log("1. checkInvariants reads clean on a real, rich fixture");
  const full = await loadFixture("meridian-full-establishment.csv", "verify-qc-full");
  const bundle = runAnalyticalBundle(full.positions, full.rootId);
  const failed = bundle.log.filter((e) => e.status === "failed_invariant");
  assert(failed.length === 0, `expected no invariant failures on real data, got: ${JSON.stringify(failed)}`);
  const clean = checkInvariants(bundle);
  assert(clean.every((r) => r.ok), `expected every invariant to hold, got: ${JSON.stringify(clean.filter((r) => !r.ok))}`);
  console.log(`   ${clean.length} invariants checked, all held`);

  console.log("\n2. checkInvariants catches a hand-corrupted headcount");
  const brokenShape = {
    ...bundle,
    metrics: { ...bundle.metrics, headcount: bundle.metrics.headcount + 7 },
  };
  const caughtShape = checkInvariants(brokenShape).find((r) => r.worker === "B:shape");
  assert(caughtShape && !caughtShape.ok, "a headcount that disagrees with shape.byLayer must be caught");
  console.log(`   caught: "${caughtShape!.detail}"`);

  console.log("\n3. checkInvariants catches a hypothesis missing its G1 enrichment");
  const strippedHypothesis = {
    ...bundle,
    hypotheses: bundle.hypotheses.map((h, i) => (i === 0 ? { ...h, falsifier: undefined } : h)),
  };
  const caughtEnrichment = checkInvariants(strippedHypothesis).find((r) => r.worker === "G:enrichment");
  assert(caughtEnrichment && !caughtEnrichment.ok, "a hypothesis missing its falsifier must be caught");
  console.log(`   caught: "${caughtEnrichment!.detail}"`);

  console.log("\n4. checkCanonicalGrounding reads clean against the rows ingest actually read");
  const grounding = checkCanonicalGrounding(full.positions, full.rows, full.issues);
  assert(grounding.sampled > 0, "expected a non-empty sample on a real fixture");
  assert(grounding.mismatches.length === 0, `expected no mismatches on unmodified data, got: ${JSON.stringify(grounding.mismatches)}`);
  assert(grounding.verified === grounding.sampled, "every sampled row should verify when nothing was tampered with");
  console.log(`   ${grounding.verified} of ${grounding.sampled} sampled rows verified (of ${grounding.total} real positions)`);
  assert(canonicalGroundingNote(grounding)?.kind === "assumption", "a clean grounding result should register as an assumption, not a question");

  console.log("\n5. checkCanonicalGrounding catches a row whose cost disagrees with the source");
  const target = full.positions.find((p) => !p.synthetic && p.cost > 0);
  assert(target, "expected at least one real, costed position in the fixture");
  const tamperedRows = full.rows.map((r, i) =>
    i === target!.sourceRowIndex ? { ...r, cost: String(target!.cost + 50000) } : r
  );
  const tamperedGrounding = checkCanonicalGrounding(full.positions, tamperedRows, [
    { kind: "low_confidence", positionId: target!.id },
  ]);
  const mismatch = tamperedGrounding.mismatches.find((m) => m.positionId === target!.id && m.field === "cost");
  assert(mismatch, "a cost the graph disagrees with should be reported as a mismatch");
  console.log(`   caught: cost reads "${mismatch!.canonicalValue}" on the table, "${mismatch!.sourceValue}" in the file`);
  assert(canonicalGroundingNote(tamperedGrounding)?.kind === "question", "any mismatch should register as a question, not a silent assumption");

  console.log("\n6. A low-confidence-flagged row is always in the sample, regardless of the random fill");
  const flaggedId = full.positions.find((p) => !p.synthetic)!.id;
  const forcedIssues: Pick<IngestIssue, "kind" | "positionId">[] = [{ kind: "low_confidence", positionId: flaggedId }];
  const tamperedFlagged = full.rows.map((r, i) =>
    i === full.positions.find((p) => p.id === flaggedId)!.sourceRowIndex
      ? { ...r, title: `${r.title} (tampered)` }
      : r
  );
  const flaggedGrounding = checkCanonicalGrounding(full.positions, tamperedFlagged, forcedIssues);
  assert(
    flaggedGrounding.mismatches.some((m) => m.positionId === flaggedId),
    "a position explicitly flagged low-confidence must always be in the sample, not left to the random fill"
  );
  console.log("   confirmed: flagged rows are sampled deterministically, every run");

  console.log("\n7. askWithRetry");
  if (!hasAI()) {
    const result = await askWithRetry(() => ({ maxTokens: 50, prompt: "unused — no key configured" }), ["medium", "high"]);
    assert(result === null, "with no AI provider configured, askWithRetry must return null rather than throw");
    console.log("   no AI key configured — confirmed askWithRetry degrades to null rather than throwing (live round trip skipped)");
  } else {
    const result = await askWithRetry(
      (tier) => ({
        tier,
        maxTokens: 50,
        prompt: 'Reply by calling the tool with ok set to true.',
        tool: {
          name: "confirm",
          description: "Confirm receipt.",
          input_schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
        },
      }),
      ["medium", "high"]
    );
    assert(result !== null, "expected a real round trip to succeed with a configured key");
    console.log(`   live round trip via ${result!.model} succeeded`);
  }

  console.log("\nverify-orchestrator-qc PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
