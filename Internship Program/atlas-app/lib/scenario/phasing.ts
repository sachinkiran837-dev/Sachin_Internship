import churnConfig from "@/config/churn-budget.json";
import { analyseAllPlays, type PlayAnalysis } from "@/lib/scenario/plays";
import { remove, reassign, rebase } from "@/lib/scenario/moves";
import { computeScenarioImpact } from "@/lib/scenario/impact";
import { computeScenarioIrReading } from "@/lib/analysis/irEbaOverlay";
import type { Position } from "@/lib/graph/types";

/**
 * h3-implementation-phasing: stages a scenario into an ordered rollout
 * instead of one cutover. The default sequence is fixed for a reason and
 * built directly over the plays that already implement each step, per the
 * spec's own composition list — never re-derived from a raw position diff,
 * which couldn't reliably tell a funded-vacant removal from any other kind
 * without re-deriving D2's own vacancy reading a second time.
 */

export type PhaseId =
  | "validate-register"
  | "consultation-path"
  | "funded-vacant-quick-wins"
  | "management-consolidation"
  | "shared-service-build"
  | "agency-conversion";

const PHASE_PLAYS: Partial<Record<PhaseId, string[]>> = {
  "funded-vacant-quick-wins": ["vacancy-rationalisation"],
  "management-consolidation": ["pass-through-layers", "deep-chain-compression", "manager-ratio"],
  "shared-service-build": ["shared-service"],
  "agency-conversion": ["agency-premium", "contractor-insourcing"],
};

const PHASE_LABELS: Record<PhaseId, string> = {
  "validate-register": "Validate the protected register",
  "consultation-path": "Open the consultation path",
  "funded-vacant-quick-wins": "Quick wins: funded-vacant removals",
  "management-consolidation": "Management consolidation",
  "shared-service-build": "Shared-service build",
  "agency-conversion": "Agency conversion",
};

function milestoneFor(id: PhaseId, roleCount: number): string {
  switch (id) {
    case "validate-register":
      return "Client sign-off on the protected-controls register — a named person, a dated confirmation. No phase beyond this one is scheduled without it.";
    case "consultation-path":
      return "Major-change consultation opened under the applicable award, agreement or the Fair Work Act's model consultation term, ahead of any role in this sequence being touched.";
    case "funded-vacant-quick-wins":
      return `Communicate closure of ${roleCount} funded-but-vacant position${roleCount === 1 ? "" : "s"} — no redundancy, no incumbent, the lowest-disruption step in the sequence.`;
    case "management-consolidation":
      return `Consultation on ${roleCount} management role${roleCount === 1 ? "" : "s"} affected by layer and single-report-chain removal, with redeployment options confirmed before any notice is given.`;
    case "shared-service-build":
      return "Stand up the shared-service structure — reporting lines redirected, most-senior holder confirmed — before any role inside it is removed.";
    case "agency-conversion":
      return "Confirm roster, vacancy, shift-fill and invoice data before converting — sequenced last because it is the phase most dependent on data the engagement may not yet have.";
  }
}

export interface Phase {
  id: PhaseId;
  label: string;
  milestone: string;
  playIds: string[];
  roleCount: number;
  /** This phase's own gross saving — not the running scenario total. */
  costContribution: number;
  /** This phase's own incremental net-at-run-rate, from h2, never recomputed independently. */
  incrementalNet: number;
  withheld: boolean;
  withheldReason: string | null;
}

export interface UngroupedPlay {
  playId: string;
  playName: string;
  reason: string;
}

export interface ChurnBudgetCheck {
  cumulativeChurn: number;
  cumulativeChurnRate: number;
  budget: number;
  overBudget: boolean;
  /** The first phase (in sequence) at which cumulative churn crossed the budget, even if no single phase alone would have. */
  crossedAtPhase: PhaseId | null;
}

export interface PhaseLadder {
  signOffConfirmed: boolean;
  phases: Phase[];
  ungroupedPlays: UngroupedPlay[];
  churnBudget: ChurnBudgetCheck;
}

function applyOperations(positions: Position[], rootId: string | null, analysis: PlayAnalysis): Position[] {
  let current = positions;
  for (const op of analysis.operations) {
    if (!current.some((p) => p.id === op.positionId)) continue;
    const outcome =
      op.kind === "remove"
        ? remove(current, rootId, op.positionId)
        : op.kind === "reassign"
          ? reassign(current, rootId, op.positionId, op.newManagerId)
          : rebase(current, op.positionId, { cost: op.cost, status: op.status, reason: op.reason });
    if (!outcome.blocked) current = outcome.positions;
  }
  return current;
}

const SEQUENCE: PhaseId[] = [
  "validate-register",
  "consultation-path",
  "funded-vacant-quick-wins",
  "management-consolidation",
  "shared-service-build",
  "agency-conversion",
];

/**
 * Builds the default phase ladder for whatever this establishment's plays
 * currently find — not a single drafted scenario's change set, since Atlas
 * doesn't yet have a "commit to this exact combination of plays as one
 * named scenario" concept beyond the plays themselves. Each phase's roles
 * and figures come from its own plays' own candidates; nothing here is
 * re-derived.
 */
export function buildPhaseLadder(positions: Position[], rootId: string | null, signOffConfirmed: boolean): PhaseLadder {
  const allPlays = analyseAllPlays(positions, rootId);
  const priced = new Map(allPlays.map((p) => [p.play.id, p] as const));

  const groupedPlayIds = new Set(Object.values(PHASE_PLAYS).flat());
  const ungroupedPlays: UngroupedPlay[] = allPlays
    .filter(({ play, analysis }) => analysis.candidates.length > 0 && !groupedPlayIds.has(play.id))
    .map(({ play }) => ({
      playId: play.id,
      playName: play.name,
      reason: "Found real candidates but doesn't source any of H3's four fixed phases — not part of the default sequence.",
    }));

  const phases: Phase[] = [];
  let cumulative = positions;
  let crossedAtPhase: PhaseId | null = null;
  const budget = churnConfig.churnBudgetShare;

  for (const id of SEQUENCE) {
    if (id === "validate-register") {
      phases.push({ id, label: PHASE_LABELS[id], milestone: milestoneFor(id, 0), playIds: [], roleCount: 0, costContribution: 0, incrementalNet: 0, withheld: false, withheldReason: null });
      continue;
    }
    if (!signOffConfirmed) {
      phases.push({
        id,
        label: PHASE_LABELS[id],
        milestone: milestoneFor(id, 0),
        playIds: PHASE_PLAYS[id] ?? [],
        roleCount: 0,
        costContribution: 0,
        incrementalNet: 0,
        withheld: true,
        withheldReason: "The client has not yet signed off the protected-controls register — no phase beyond validation may be scheduled.",
      });
      continue;
    }
    if (id === "consultation-path") {
      phases.push({ id, label: PHASE_LABELS[id], milestone: milestoneFor(id, 0), playIds: [], roleCount: 0, costContribution: 0, incrementalNet: 0, withheld: false, withheldReason: null });
      continue;
    }

    const playIds = PHASE_PLAYS[id] ?? [];
    const phasePlays = playIds.map((pid) => priced.get(pid)).filter((p): p is NonNullable<typeof p> => Boolean(p) && p!.analysis.candidates.length > 0);

    const before = cumulative;
    for (const p of phasePlays) cumulative = applyOperations(cumulative, rootId, p.analysis);

    const roleCount = phasePlays.reduce((s, p) => s + p.analysis.candidates.length, 0);
    const costContribution = phasePlays.reduce((s, p) => s + p.analysis.projectedSaving, 0);
    const incrementalNet =
      cumulative === before ? 0 : computeScenarioImpact(before, `phase-${id}`, PHASE_LABELS[id], cumulative, rootId).financial.netAtRunRate;

    phases.push({
      id,
      label: PHASE_LABELS[id],
      milestone: milestoneFor(id, roleCount),
      playIds,
      roleCount,
      costContribution,
      incrementalNet,
      withheld: false,
      withheldReason: roleCount === 0 ? "No play in this phase found a candidate on this establishment." : null,
    });

    if (crossedAtPhase === null && roleCount > 0) {
      const ir = computeScenarioIrReading(positions, cumulative, positions.filter((p) => !cumulative.some((c) => c.id === p.id)));
      if (ir.overChurnBudget) crossedAtPhase = id;
    }
  }

  const finalIr = computeScenarioIrReading(positions, cumulative, positions.filter((p) => !cumulative.some((c) => c.id === p.id)));

  return {
    signOffConfirmed,
    phases,
    ungroupedPlays,
    churnBudget: {
      cumulativeChurn: finalIr.churn,
      cumulativeChurnRate: finalIr.churnRate,
      budget,
      overBudget: finalIr.overChurnBudget,
      crossedAtPhase,
    },
  };
}

export const H3_METHOD =
  "The default sequence is fixed — validate register, open consultation, funded-vacant quick wins, management " +
  "consolidation, shared-service build, agency conversion last — sourced directly from the plays that already " +
  "implement each step, never re-derived from a raw position diff. No phase beyond validation is scheduled without a " +
  "stated client sign-off. The churn-budget check runs across the whole cumulative sequence, not per phase in " +
  "isolation — two phases individually within budget can still blow it together, and only a sequence-level check " +
  "catches that.";
