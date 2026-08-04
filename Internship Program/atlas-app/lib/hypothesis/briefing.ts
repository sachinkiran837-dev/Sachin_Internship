import { pushbackFor, type Pushback } from "@/lib/hypothesis/pushback";
import type { Hypothesis } from "@/lib/hypothesis/build";
import type { ReconciliationResult } from "@/lib/scenario/reconcile";
import { STANDING_CAVEAT } from "@/lib/analysis/irEbaOverlay";

/**
 * i2-consultant-briefing: the deeper, operator-facing counterpart to the
 * board pack — ranked threads, evidence and questions carried verbatim from
 * g1-hypothesis-generation, an anticipated pushback per thread, data asks
 * framed as unlocks (G1's `dataAsk` already is one), and the phasing
 * conversation opened early rather than deferred to an appendix.
 */

const CONFIDENCE_WEIGHT: Record<"high" | "medium" | "low", number> = { high: 1, medium: 0.6, low: 0.3 };

export interface BriefingThread {
  hypothesis: Hypothesis;
  /** Net-at-run-rate from G2's reconciled stack when this thread has an attached, priced play; null otherwise — never re-derived from the hypothesis's own (potentially gross, potentially contested) prize figure. */
  sizing: number | null;
  score: number;
  pushback: Pushback;
}

export interface ConsultantBriefing {
  threads: BriefingThread[];
  consultationOpener: string;
  pressureTestInstruction: string;
}

const CONSULTATION_OPENER =
  "Open the consultation conversation on day one, not after a scenario is drafted: major-change consultation obligations " +
  "likely apply to anything raised here that touches headcount, and starting that conversation late is the single most " +
  "common reason a defensible number becomes an unwinnable room. " +
  STANDING_CAVEAT;

const PRESSURE_TEST_INSTRUCTION =
  "Pressure-test every scenario drawn from these threads against three things before it goes anywhere near a board: the " +
  "operational reality on the ground, the awards and enterprise agreements that actually cover the roles in scope, and " +
  "the politics in the room. A thread that survives the evidence can still fail on any one of these — that is the " +
  "operator's judgement to apply, not something this document can price in.";

/**
 * Rank by prize and prosecutability together, per the skill's own rule: a
 * large low-confidence thread and a small high-confidence one are both
 * ranked on the same scale, not just the largest dollar figure surfaced
 * first. `score` is shown alongside the rank, not hidden inside it.
 */
function scoreOf(hypothesis: Hypothesis, sizing: number | null): number {
  const magnitude = sizing !== null && sizing > 0 ? sizing : Math.max(hypothesis.weight, 0);
  const confidence = CONFIDENCE_WEIGHT[hypothesis.confidenceGrade ?? "low"];
  return magnitude * confidence;
}

export function buildBriefing(hypotheses: Hypothesis[], reconciled: ReconciliationResult): ConsultantBriefing {
  const sizingByPlay = new Map(reconciled.opportunities.map((o) => [o.playId, o.netAtRunRate] as const));

  const threads: BriefingThread[] = hypotheses
    .filter((h) => h.confidenceGrade !== undefined)
    .map((h) => {
      const sizing = h.playId ? sizingByPlay.get(h.playId) ?? null : null;
      return { hypothesis: h, sizing, score: scoreOf(h, sizing), pushback: pushbackFor(h) };
    })
    .sort((a, b) => b.score - a.score);

  return {
    threads,
    consultationOpener: CONSULTATION_OPENER,
    pressureTestInstruction: PRESSURE_TEST_INSTRUCTION,
  };
}
