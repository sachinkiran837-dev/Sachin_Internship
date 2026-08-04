import { computeTransitionCost } from "@/lib/analysis/irEbaOverlay";
import type { PlayAnalysis, PlayMeta } from "@/lib/scenario/plays";
import type { Position } from "@/lib/graph/types";

/**
 * g2-value-sizing: reads every priced play's own candidates and reconciles
 * them into one headline stack before any total reaches a client-facing
 * screen — the no-double-count rule. One role counts in one opportunity.
 *
 * Deliberately built over `PlayAnalysis.candidates` rather than retrofitting
 * a position-id list onto every hypothesis in build.ts: the plays already
 * carry the real role-level detail this reconciliation needs (`positionId`,
 * `saving`), and re-deriving it a second time at the hypothesis layer is
 * exactly the kind of duplicated arithmetic that lets two screens disagree
 * about the same number — the same discipline `contingentReliance.ts`
 * already applies to the agency-premium play it reuses rather than re-prices.
 */

export type EstimateClass = "computed" | "estimated" | "requires-data";
export type ValueType = "cashable" | "cost-avoidance" | "capacity-release";

const ESTIMATED_PLAYS = new Set(["agency-premium", "contractor-insourcing"]);

function estimateClassFor(analysis: PlayAnalysis): EstimateClass {
  if (analysis.candidates.length === 0) return "computed";
  if (analysis.projectedSaving === 0) return "requires-data";
  if (ESTIMATED_PLAYS.has(analysis.playId)) return "estimated";
  return "computed";
}

/**
 * cost-out and cost-rebase both reduce cash spend (one by removing a role,
 * the other by buying the same work at a lower price) — both read cashable.
 * cost-avoidance reads as its own type. No play in this library currently
 * produces a genuine capacity-release figure (freed hours redeployed rather
 * than a dollar saved) — the bucket stays honestly empty rather than forcing
 * a mapping that isn't there.
 */
function valueTypeFor(analysis: PlayAnalysis): ValueType {
  return analysis.savingNature === "cost-avoidance" ? "cost-avoidance" : "cashable";
}

export interface ContestedRole {
  positionId: string;
  title: string;
  /** Every opportunity that claimed this role, highest saving first. */
  claimants: { playId: string; playName: string; saving: number }[];
  /** The default reconciliation: highest value wins. A human call the tool surfaces, not resolves alone. */
  wonBy: string;
}

export interface ReconciledOpportunity {
  playId: string;
  playName: string;
  lens: PlayMeta["lens"];
  grossSaving: number;
  /** Saving after contested roles won by another opportunity are removed. */
  netSaving: number;
  contestedRolesLost: number;
  estimateClass: EstimateClass;
  valueType: ValueType;
  transitionCost: number;
  /** netSaving minus transitionCost — the figure a board pack should show, never the gross. */
  netAtRunRate: number;
  /** Months to recover transitionCost out of the annual netSaving. Null when netSaving <= 0 — there is no break-even. */
  breakEvenMonths: number | null;
}

export interface ReconciliationResult {
  opportunities: ReconciledOpportunity[];
  contestedRoles: ContestedRole[];
  headline: {
    grossStack: number;
    /** The reconciled, no-double-count, net-of-transition figure — the only one safe to show as a single number. */
    netStack: number;
    byEstimateClass: Record<EstimateClass, number>;
    byValueType: Record<ValueType, number>;
  };
}

export function reconcileValue(
  positions: Position[],
  plays: { play: PlayMeta; analysis: PlayAnalysis }[]
): ReconciliationResult {
  const priced = plays.filter((p) => p.analysis.candidates.length > 0 && p.analysis.projectedSaving > 0);
  const positionById = new Map(positions.map((p) => [p.id, p] as const));

  // Every candidate role, across every priced play, with what it would be worth there.
  const claimsByRole = new Map<string, { positionId: string; title: string; playId: string; playName: string; saving: number }[]>();
  for (const { play, analysis } of priced) {
    for (const c of analysis.candidates) {
      const list = claimsByRole.get(c.positionId) ?? [];
      list.push({ positionId: c.positionId, title: c.title, playId: play.id, playName: play.name, saving: c.saving });
      claimsByRole.set(c.positionId, list);
    }
  }

  const contestedRoles: ContestedRole[] = [];
  const loserAmountByPlay = new Map<string, number>();
  const loserCountByPlay = new Map<string, number>();
  // Roles a play lost to reconciliation — its transition cost must exclude
  // them too, or a play that lost its only role still gets charged for
  // removing it while another opportunity now claims the saving.
  const lostRolesByPlay = new Map<string, Set<string>>();

  for (const [positionId, claims] of claimsByRole) {
    if (claims.length < 2) continue;
    const ranked = [...claims].sort((a, b) => b.saving - a.saving);
    const winner = ranked[0];
    contestedRoles.push({
      positionId,
      title: winner.title,
      claimants: ranked,
      wonBy: winner.playId,
    });
    for (const loser of ranked.slice(1)) {
      loserAmountByPlay.set(loser.playId, (loserAmountByPlay.get(loser.playId) ?? 0) + loser.saving);
      loserCountByPlay.set(loser.playId, (loserCountByPlay.get(loser.playId) ?? 0) + 1);
      const set = lostRolesByPlay.get(loser.playId) ?? new Set<string>();
      set.add(positionId);
      lostRolesByPlay.set(loser.playId, set);
    }
  }

  const opportunities: ReconciledOpportunity[] = priced.map(({ play, analysis }) => {
    const netSaving = analysis.projectedSaving - (loserAmountByPlay.get(play.id) ?? 0);
    const lostHere = lostRolesByPlay.get(play.id);
    const removedPositions = analysis.operations
      .filter((op) => op.kind === "remove" && !lostHere?.has(op.positionId))
      .map((op) => positionById.get(op.positionId))
      .filter((p): p is Position => p !== undefined);
    const transitionCost = removedPositions.reduce((s, p) => s + computeTransitionCost(p).transitionCost, 0);
    const netAtRunRate = netSaving - transitionCost;

    return {
      playId: play.id,
      playName: play.name,
      lens: play.lens,
      grossSaving: analysis.projectedSaving,
      netSaving,
      contestedRolesLost: loserCountByPlay.get(play.id) ?? 0,
      estimateClass: estimateClassFor(analysis),
      valueType: valueTypeFor(analysis),
      transitionCost,
      netAtRunRate,
      breakEvenMonths: netSaving > 0 ? transitionCost / (netSaving / 12) : null,
    };
  });

  const grossStack = opportunities.reduce((s, o) => s + o.grossSaving, 0);
  const netStack = opportunities.reduce((s, o) => s + o.netAtRunRate, 0);

  const byEstimateClass: Record<EstimateClass, number> = { computed: 0, estimated: 0, "requires-data": 0 };
  const byValueType: Record<ValueType, number> = { cashable: 0, "cost-avoidance": 0, "capacity-release": 0 };
  for (const o of opportunities) {
    byEstimateClass[o.estimateClass] += o.netAtRunRate;
    byValueType[o.valueType] += o.netAtRunRate;
  }

  return {
    opportunities: opportunities.sort((a, b) => b.netAtRunRate - a.netAtRunRate),
    contestedRoles,
    headline: { grossStack, netStack, byEstimateClass, byValueType },
  };
}

export const VALUE_SIZING_METHOD =
  "Every opportunity is priced by its own play, never re-derived here. A role claimed by more than one opportunity is " +
  "awarded to whichever prices it highest — a default reconciliation this module surfaces, not a judgment call it makes " +
  "unreviewably; the losing opportunity's total is reduced and the contested role is listed explicitly, never silently " +
  "dropped. Every figure is net of NES transition cost before it reaches a headline, and estimate class (computed / " +
  "estimated / requires-data) travels with every number rather than being flattened into one blended total.";
