import { currency } from "@/lib/format/currency";
import { analyseAllPlays, type PlayMeta, type PlayAnalysis } from "@/lib/scenario/plays";
import { reconcileValue, type EstimateClass } from "@/lib/scenario/reconcile";
import { analyseFunctions } from "@/lib/analysis/functions";
import { buildVacancyHygiene } from "@/lib/analysis/vacancyHygiene";
import { buildContingentReliance } from "@/lib/analysis/contingentReliance";
import { buildPeerBenchmark, type PeerBandReading, type PeerCohort } from "@/lib/analysis/peerBenchmark";
import { STANDING_CAVEAT } from "@/lib/analysis/irEbaOverlay";
import { buildPhaseLadder, type Phase } from "@/lib/scenario/phasing";
import type { Hypothesis } from "@/lib/hypothesis/build";
import type { BusinessContext } from "@/lib/hypothesis/context";
import type { DiagnosticMetrics, Position, ProtectedTier } from "@/lib/graph/types";

/**
 * i1-board-pack-synthesis: the one pack the client keeps, deliberately short
 * of the full answer. Everything here is pulled verbatim from the skill that
 * already computed it — G2's reconciled stack, G1's graded hypotheses, F1's
 * band verdicts, E1's register, H3's phase ladder — nothing is recomputed a
 * second time in this file.
 *
 * The skill spec labels the judgment sentence a "model call, with a
 * deterministic figure underneath." This build keeps it deterministic and
 * templated instead, the same choice G1's archetype copy already made: a
 * template built only from the reconciled figure and the protection count
 * can't say anything the pack doesn't already show, which is worth more in
 * a document the client keeps than a better-written sentence would be. (See
 * `lib/ai/client.ts`'s `AiTier` doc comment for where a model is used
 * elsewhere — narrative synthesis is deliberately not one of those places.)
 */

export interface ValueTile {
  estimateClass: EstimateClass;
  amount: number;
  opportunityCount: number;
}

export interface ProtectionStory {
  totalHeld: number;
  byTier: Record<ProtectedTier, number>;
  controlGapCount: number;
  statement: string;
}

export interface BoardPack {
  headlineAmount: number;
  judgmentSentence: string;
  valueTiles: ValueTile[];
  whereTheValueIs: Hypothesis[];
  howYouCompare: { reading: PeerBandReading; cohort: PeerCohort }[];
  protectionStory: ProtectionStory;
  nextSteps: Phase[];
  standingCaveat: string;
  sourceCitation: string;
  preparedBy: string;
}

const TIER_LABEL: Record<ProtectedTier, string> = {
  statutory: "statutory",
  governance: "governance-mandated",
  safety: "safety-critical",
};

function judgmentSentence(headline: number, protection: ProtectionStory): string {
  if (headline <= 0) {
    return "Nothing in this establishment currently reconciles to a priced opportunity — the diagnostic is a structural read, not a savings case, until a play finds a real candidate.";
  }
  return (
    `The prize is real. Capturing it safely, inside the ${protection.totalHeld} role${protection.totalHeld === 1 ? "" : "s"} this ` +
    `redesign holds and the industrial instruments that cover this workforce, is the judgement call.`
  );
}

function protectionStatement(totalHeld: number, byTier: Record<ProtectedTier, number>, controlGapCount: number): string {
  const parts = (Object.keys(TIER_LABEL) as ProtectedTier[])
    .filter((t) => byTier[t] > 0)
    .map((t) => `${byTier[t]} ${TIER_LABEL[t]}`);
  const base = `${totalHeld} role${totalHeld === 1 ? "" : "s"} held${parts.length > 0 ? `: ${parts.join(", ")}` : ""}.`;
  return controlGapCount > 0
    ? `${base} ${controlGapCount} mandated role${controlGapCount === 1 ? "" : "s"} in the register currently ${controlGapCount === 1 ? "has" : "have"} no match in this establishment — see the control-gap finding before treating coverage as complete.`
    : base;
}

export function buildBoardPack(
  positions: Position[],
  rootId: string | null,
  business: BusinessContext,
  metrics: DiagnosticMetrics,
  hypotheses: Hypothesis[],
  signOffConfirmed: boolean
): BoardPack {
  const plays: { play: PlayMeta; analysis: PlayAnalysis }[] = analyseAllPlays(positions, rootId);
  const reconciled = reconcileValue(positions, plays);

  // Same construction as build.ts's own — F1 needs the self-relative
  // comparison and D1's reliance reading, sourced once, never re-derived.
  const comparison = analyseFunctions(positions, rootId, business).primary;
  const agencyShareByUnit = new Map(comparison.units.map((u) => [u.key, u.agencyShare] as const));
  const vacancy = buildVacancyHygiene(positions, rootId, agencyShareByUnit);
  const reliance = buildContingentReliance(positions, rootId, comparison, vacancy);
  const peer = buildPeerBenchmark(positions, rootId, metrics, metrics.shape.managerCost, business, comparison, reliance);

  const valueTiles: ValueTile[] = (["computed", "estimated", "requires-data"] as EstimateClass[])
    .map((estimateClass) => {
      const opportunities = reconciled.opportunities.filter((o) => o.estimateClass === estimateClass);
      return {
        estimateClass,
        amount: opportunities.reduce((s, o) => s + o.netAtRunRate, 0),
        opportunityCount: opportunities.length,
      };
    })
    .filter((t) => t.opportunityCount > 0);

  const whereTheValueIs = hypotheses
    .filter((h) => h.confidenceGrade && (h.provokingQuestions?.length ?? 0) > 0)
    .slice(0, 6);

  const howYouCompare = peer.readings
    .filter((r) => r.verdict !== "not computable")
    .map((reading) => ({ reading, cohort: peer.cohort }));

  const protectionStory: ProtectionStory = {
    totalHeld: metrics.protectedCount,
    byTier: metrics.protectedByTier,
    controlGapCount: metrics.controlGaps.length,
    statement: protectionStatement(metrics.protectedCount, metrics.protectedByTier, metrics.controlGaps.length),
  };

  const phaseLadder = buildPhaseLadder(positions, rootId, signOffConfirmed);
  const nextSteps = phaseLadder.phases.filter((p) => !p.withheld);

  return {
    headlineAmount: reconciled.headline.netStack,
    judgmentSentence: judgmentSentence(reconciled.headline.netStack, protectionStory),
    valueTiles,
    whereTheValueIs,
    howYouCompare,
    protectionStory,
    nextSteps,
    standingCaveat: STANDING_CAVEAT,
    sourceCitation: `Generated from the confirmed establishment as ingested. ${metrics.headcount} positions, ${currency(metrics.totalCost)} total cost.`,
    preparedBy: "Prepared by Atlas — a computed read, not a consulting opinion.",
  };
}
