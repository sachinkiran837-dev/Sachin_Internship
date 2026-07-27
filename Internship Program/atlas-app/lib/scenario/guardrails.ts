import { matchProtectedRole } from "@/lib/protected-roles/match";
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
export function checkProtected(position: Position): GuardResult {
  const match = matchProtectedRole(position.title);
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
