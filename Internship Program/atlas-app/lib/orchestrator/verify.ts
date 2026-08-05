import type { AnalyticalBundle } from "./run";
import type { IngestIssue, Position } from "@/lib/graph/types";
import { ask, hasAI, type AiRequest, type AiResult, type AiTier } from "@/lib/ai/client";
import { note, type IngestNote } from "@/lib/ingest/notes";

/**
 * The orchestrator's two QC mechanisms — genuinely different, because "make
 * the worker work again" only means something for one of them.
 *
 * B-G's computations are pure functions: same positions in, same number out,
 * always. If one is wrong, running it again reproduces the identical wrong
 * answer — a code defect, not something a retry fixes. `checkInvariants`
 * exists for that half: it checks a real run's own internal consistency,
 * live, using the same kind of assertion the `verify-*.ts` scripts already
 * check against fixtures — just never run against a real establishment
 * before now.
 *
 * `checkCanonicalGrounding` and `askWithRetry` exist for the other half —
 * the places a worker actually read something uncertain (a source cell, a
 * free-text instruction) and could plausibly do better on a second attempt.
 */

/* -------------------------------------------------------------------- */
/* Invariant checks — deterministic workers, no retry                    */
/* -------------------------------------------------------------------- */

export interface InvariantResult {
  worker: string;
  ok: boolean;
  detail?: string;
}

/**
 * Curated, hand-picked, deliberately small. Each check here is a live
 * version of an assertion that already exists in a `verify-*.ts` script
 * against fixture data — ported to run against a real establishment's own
 * output instead, and to report rather than throw.
 */
export function checkInvariants(bundle: AnalyticalBundle): InvariantResult[] {
  const results: InvariantResult[] = [];
  const { metrics, hypotheses } = bundle;

  // scripts/verify-structure-diagnostics.ts:107 — shape.byLayer must cover headcount.
  const byLayerTotal = metrics.shape.byLayer.reduce((sum, l) => sum + l.headcount, 0);
  results.push({
    worker: "B:shape",
    ok: byLayerTotal === metrics.headcount,
    detail:
      byLayerTotal === metrics.headcount
        ? undefined
        : `shape.byLayer covers ${byLayerTotal} but headcount is ${metrics.headcount}`,
  });

  // scripts/verify-workforce-risk.ts:62 — protectedByDirectorate must reconcile to protectedCount.
  const byDirectorateTotal = metrics.protectedByDirectorate.reduce((sum, d) => sum + d.count, 0);
  results.push({
    worker: "E1:protected-roles",
    ok: byDirectorateTotal === metrics.protectedCount,
    detail:
      byDirectorateTotal === metrics.protectedCount
        ? undefined
        : `protectedByDirectorate covers ${byDirectorateTotal} but protectedCount is ${metrics.protectedCount}`,
  });

  // Non-negativity — a diagnostic reading, not raw input, so a negative value
  // here is always a bug in the code that produced it.
  results.push({
    worker: "B:hygiene",
    ok: metrics.hygiene.orphanCount >= 0,
    detail: metrics.hygiene.orphanCount >= 0 ? undefined : `orphanCount is negative: ${metrics.hygiene.orphanCount}`,
  });
  results.push({
    worker: "A3:cost",
    ok: metrics.totalCost >= 0,
    detail: metrics.totalCost >= 0 ? undefined : `totalCost is negative: ${metrics.totalCost}`,
  });

  // G's own enrichment contract: every hypothesis buildHypotheses returns has
  // already passed through archetypes.ts's single enrichment pass — a
  // hypothesis missing a grade, a falsifier, or its three questions is a real
  // regression in that pass, not a hypothesis Atlas ever meant to show
  // half-graded.
  const unenriched = hypotheses.filter(
    (h) => !h.confidenceGrade || !h.falsifier || (h.provokingQuestions?.length ?? 0) !== 3
  );
  results.push({
    worker: "G:enrichment",
    ok: unenriched.length === 0,
    detail:
      unenriched.length === 0
        ? undefined
        : `${unenriched.length} of ${hypotheses.length} hypotheses left G without a grade, falsifier or all three questions: ${unenriched
            .slice(0, 3)
            .map((h) => h.id)
            .join(", ")}`,
  });

  return results;
}

/* -------------------------------------------------------------------- */
/* Canonical-table grounding — sampled, against the rows ingest actually */
/* read, no retry (a mismatch here is a mapping bug, not noise)          */
/* -------------------------------------------------------------------- */

export interface CanonicalMismatch {
  positionId: string;
  field: "title" | "cost" | "fte";
  canonicalValue: string;
  sourceValue: string;
}

export interface CanonicalGrounding {
  total: number;
  sampled: number;
  verified: number;
  mismatches: CanonicalMismatch[];
}

export const EMPTY_GROUNDING: CanonicalGrounding = { total: 0, sampled: 0, verified: 0, mismatches: [] };

/** Roughly 5-10% of the establishment, plus every row already flagged low-confidence. */
const RANDOM_SAMPLE_RATE = 0.08;
/** A ceiling so a very large establishment doesn't sample without bound — this check is free, but not unbounded. */
const MAX_SAMPLE = 300;

function normaliseText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Extracts the first number out of a cell that may carry a currency symbol, commas, or nothing parseable at all. */
function parseNumeric(raw: string): number | null {
  const match = raw.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

/**
 * Spot-checks sampled canonical rows against the rows ingest actually read —
 * the same reference `verifyStructureAgainstMap` already checks reporting
 * lines against, generalised here to cell values.
 *
 * Deliberately scoped to title, cost and FTE — the fields that exist
 * regardless of anonymization and that every downstream cost/headcount
 * figure is built from. Name is left out on purpose: comparing an
 * anonymized `displayName` back against the raw file's name column would
 * defeat the anonymization it's supposed to have, not verify it.
 *
 * A cell that doesn't parse to a number at all (a raw "TBC" or "confidential")
 * is not a mismatch to report here — that is the cost/FTE parser's own job to
 * have already flagged as a data-quality issue. This only flags a case where
 * both sides parsed to a value and they genuinely disagree.
 */
export function checkCanonicalGrounding(
  positions: Position[],
  boundRows: Record<string, string>[],
  issues: Pick<IngestIssue, "kind" | "positionId">[]
): CanonicalGrounding {
  const real = positions.filter((p) => !p.synthetic);
  if (real.length === 0 || boundRows.length === 0) return EMPTY_GROUNDING;

  const lowConfidenceIds = new Set(
    issues.filter((i) => i.kind === "low_confidence" && i.positionId).map((i) => i.positionId as string)
  );

  const flagged = real.filter((p) => lowConfidenceIds.has(p.id));
  const rest = real.filter((p) => !lowConfidenceIds.has(p.id));

  const randomTarget = Math.min(
    MAX_SAMPLE - flagged.length,
    Math.max(0, Math.ceil(real.length * RANDOM_SAMPLE_RATE) - flagged.length)
  );
  const randomFill = [...rest].sort(() => Math.random() - 0.5).slice(0, Math.max(0, randomTarget));

  const sample = [...flagged, ...randomFill];
  const mismatches: CanonicalMismatch[] = [];

  for (const position of sample) {
    const row = boundRows[position.sourceRowIndex];
    if (!row) continue;

    if (row.title && normaliseText(row.title) !== normaliseText(position.title)) {
      mismatches.push({
        positionId: position.id,
        field: "title",
        canonicalValue: position.title,
        sourceValue: row.title,
      });
    }

    const sourceCost = row.cost ? parseNumeric(row.cost) : null;
    if (sourceCost !== null && Math.abs(sourceCost - position.cost) > 0.01) {
      mismatches.push({
        positionId: position.id,
        field: "cost",
        canonicalValue: String(position.cost),
        sourceValue: row.cost,
      });
    }

    const sourceFte = row.fte ? parseNumeric(row.fte) : null;
    if (sourceFte !== null && Math.abs(sourceFte - position.fte) > 0.01) {
      mismatches.push({
        positionId: position.id,
        field: "fte",
        canonicalValue: String(position.fte),
        sourceValue: row.fte,
      });
    }
  }

  const mismatchedIds = new Set(mismatches.map((m) => m.positionId));

  return {
    total: real.length,
    sampled: sample.length,
    verified: sample.length - mismatchedIds.size,
    mismatches,
  };
}

/**
 * The result, said in one paragraph on the confirm screen — same shape as
 * `verifyStructure.ts`'s `verificationNote`, because it's the same kind of
 * claim: a reading that was tested rather than asserted, or a gap the client
 * has to look at before trusting it.
 */
export function canonicalGroundingNote(g: CanonicalGrounding): IngestNote | null {
  if (g.sampled === 0) return null;
  const pct = ((g.verified / g.sampled) * 100).toFixed(0);

  if (g.mismatches.length === 0) {
    return note("canonical-grounding-qc", "assumption", {
      topic: "Canonical table checked against your file",
      statement: `Atlas spot-checked ${g.sampled.toLocaleString()} of ${g.total.toLocaleString()} rows' title, cost and FTE against the file they were read from, and every one matched.`,
      evidence: `${g.verified.toLocaleString()} of ${g.sampled.toLocaleString()} sampled rows verified (${pct}%).`,
      effect: `The canonical table's cost and FTE figures rest on a sample checked back against your own file, not assumed correct.`,
    });
  }

  return note("canonical-grounding-qc", "question", {
    topic: "Canonical table checked against your file",
    statement: `Atlas found ${g.mismatches.length.toLocaleString()} value${g.mismatches.length === 1 ? "" : "s"} on the canonical table that disagree with the file they were read from.`,
    evidence:
      `${g.verified.toLocaleString()} of ${g.sampled.toLocaleString()} sampled rows verified (${pct}%). For example: ` +
      g.mismatches
        .slice(0, 3)
        .map((m) => `${m.field} reads "${m.canonicalValue}" on the table and "${m.sourceValue}" in the file`)
        .join("; ") +
      `.`,
    effect: `These rows are marked unverified rather than silently corrected — check them against the source before treating their cost or FTE as confirmed.`,
  });
}

/* -------------------------------------------------------------------- */
/* Retry with tier escalation — the workers that actually read something */
/* uncertain, where a second attempt can plausibly do better             */
/* -------------------------------------------------------------------- */

/**
 * Tries each tier in order, stopping at the first usable answer. "Usable"
 * means not truncated and carrying either a tool result or text — the same
 * bar every existing call site already checks before trusting a response.
 *
 * Two attempts, not an unbounded loop: a model that fails twice at
 * escalating cost is a genuine miss, not a coin flip worth spending a third
 * call on, and every caller already has a deterministic fallback for
 * exactly this case.
 */
export async function askWithRetry(
  buildRequest: (tier: AiTier) => AiRequest,
  tiers: AiTier[]
): Promise<AiResult | null> {
  if (!hasAI()) return null;
  for (const tier of tiers) {
    try {
      const result = await ask(buildRequest(tier));
      if (!result.truncated && (result.toolInput !== null || result.text.trim() !== "")) {
        return result;
      }
    } catch {
      // Try the next tier. The last failure is what a caller's own
      // deterministic fallback path is for.
    }
  }
  return null;
}
