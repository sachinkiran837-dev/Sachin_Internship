import { matchProtectedRole } from "@/lib/protected-roles/match";
import { tagNodes } from "@/lib/graph/tagging";
import type { Position } from "@/lib/graph/types";

export interface GuardResult {
  blocked: boolean;
  reason?: string;
}

/**
 * The protect-controls guardrail lives here, at the single point every
 * mutation passes through — never relied on in the UI layer alone, so it
 * can't be bypassed by a drag, a typed move, or a future add/remove control.
 */
export function checkProtected(position: Position, isUnitRoster = false): GuardResult {
  const match = matchProtectedRole(position.title, isUnitRoster);
  if (!match) return { blocked: false };
  return {
    blocked: true,
    reason: `Kept "${position.title}" in place: a protected ${match.tier} control (${match.reason}).`,
  };
}

/**
 * Heading nodes in a consolidated establishment — the brand or entity boxes
 * everything else hangs under — are scaffolding, not roles. Removing one
 * would detach an entire brand from the map, and moving one would claim a
 * reporting line between two legal entities. Neither is a redesign, so both
 * are refused at the same single point every other mutation passes through.
 */
export function checkSynthetic(position: Position): GuardResult {
  if (!position.synthetic) return { blocked: false };
  return {
    blocked: true,
    reason: `"${position.title}" is a heading Atlas added to hold the consolidated structure together, not a position — there is nothing there to move, remove or cost.`,
  };
}

export function checkRoot(positionId: string, rootId: string | null): GuardResult {
  if (positionId === rootId) {
    return { blocked: true, reason: "The top-of-house role can't be dragged or reassigned." };
  }
  return { blocked: false };
}

/** Reassigning a role to one of its own descendants would create a cycle. */
export function checkCycle(
  positions: Position[],
  positionId: string,
  newManagerId: string
): GuardResult {
  const byId = new Map(positions.map((p) => [p.id, p] as const));
  let cursor: string | null = newManagerId;
  const visited = new Set<string>();
  while (cursor) {
    if (cursor === positionId) {
      return {
        blocked: true,
        reason: "That reassignment would create a reporting-line cycle.",
      };
    }
    if (visited.has(cursor)) break;
    visited.add(cursor);
    cursor = byId.get(cursor)?.managerId ?? null;
  }
  return { blocked: false };
}

/** Deterministic tiebreak for two equidistant drop targets: lowest id wins. */
export function tiebreakNearest(candidateIds: string[]): string {
  return [...candidateIds].sort()[0];
}

/**
 * H1's guardrail 3: a manager who would receive a new report must stay
 * inside their own archetype's span ceiling afterwards — otherwise a
 * consolidation move quietly manufactures the exact wide-span problem B1
 * flags elsewhere. Checked against the position set *after* the move, so it
 * reads the receiving manager's real post-change headcount, not a guess.
 *
 * Reuses `tagNodes` rather than re-deriving the archetype ceiling directly —
 * a second, parallel span-health calculation is exactly how this guardrail
 * would end up disagreeing with B1 itself about what "wide" means for a
 * given role. This is also the only way to inherit A2's roster exemption for
 * free: a Nurse Unit Manager absorbing more clinical reports is staffing a
 * bigger roster, not running a wider management span, and `tagNodes` already
 * knows that — a guardrail that didn't reuse it would have wrongly blocked
 * exactly this move (caught live, against `wide-span-redistribution`'s own
 * candidates, while building this guardrail).
 */
export function checkPostChangeSpan(positionsAfter: Position[], rootId: string | null, managerId: string): GuardResult {
  const tagged = tagNodes(positionsAfter, rootId);
  const manager = tagged.find((n) => n.id === managerId);
  if (!manager || manager.flags.spanHealth !== "wide") return { blocked: false };

  const span = positionsAfter.filter((p) => p.managerId === managerId).length;
  return {
    blocked: true,
    reason:
      `Would leave "${manager.title}" with ${span} direct reports — a wide span against the ${manager.flags.spanArchetype} ` +
      `archetype this move would push past. Widen it deliberately as its own move if that's the intent; a consolidation ` +
      `shouldn't manufacture a wide span as a side effect.`,
  };
}

/**
 * H1's guardrail: a roster structure (A2's `unitRoster` flag — a manager
 * staffing a clinical/frontline roster, not running a management span) is
 * never touched by a management-chain move (collapse-layer, remove-single-
 * report-chain, widen-span). The lead is already auto-held by E1; this
 * extends the same exemption to the roster's *members*, who aren't
 * protected roles in their own right but whose reporting line a layer-
 * collapse or span-widening move should never reach.
 */
export function checkRosterExempt(isRosterMember: boolean, patternLabel: string): GuardResult {
  if (!isRosterMember) return { blocked: false };
  return {
    blocked: true,
    reason: `This position sits inside a clinical/frontline roster (A2) — never touched by a ${patternLabel} move, regardless of its own protection status.`,
  };
}
