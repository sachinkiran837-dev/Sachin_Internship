import { currency } from "@/lib/format/currency";
import { randomUUID } from "node:crypto";
import type { Position } from "@/lib/graph/types";
import { checkCycle, checkProtected, checkRoot, checkSynthetic } from "./guardrails";

export interface MoveOutcome {
  positions: Position[];
  blocked: boolean;
  blockReason?: string;
  description: string;
  affectedIds: string[];
}

function findByTitleOrName(positions: Position[], needle: string): Position | undefined {
  const t = needle.trim().toLowerCase();
  return positions.find(
    (p) => p.title.toLowerCase().includes(t) || p.displayName.toLowerCase().includes(t)
  );
}

/** The topmost position in a department: the one whose manager sits outside it. */
function findDepartmentRoot(positions: Position[], deptNeedle: string): Position | undefined {
  const t = deptNeedle.trim().toLowerCase();
  const deptPositions = positions.filter((p) => p.department.toLowerCase().includes(t));
  const deptIds = new Set(deptPositions.map((p) => p.id));
  return deptPositions.find((p) => !p.managerId || !deptIds.has(p.managerId));
}

/** A scenario move's subject can name either a specific role or a whole department. */
function findSubject(positions: Position[], needle: string): Position | undefined {
  return findByTitleOrName(positions, needle) ?? findDepartmentRoot(positions, needle);
}

export function reassign(
  positions: Position[],
  rootId: string | null,
  positionId: string,
  newManagerId: string
): MoveOutcome {
  const position = positions.find((p) => p.id === positionId);
  if (!position) {
    return {
      positions,
      blocked: true,
      blockReason: "Position not found.",
      description: "Reassign",
      affectedIds: [],
    };
  }

  const rootGuard = checkRoot(positionId, rootId);
  if (rootGuard.blocked) {
    return { positions, blocked: true, blockReason: rootGuard.reason, description: `Reassign "${position.title}"`, affectedIds: [positionId] };
  }

  const syntheticGuard = checkSynthetic(position);
  if (syntheticGuard.blocked) {
    return { positions, blocked: true, blockReason: syntheticGuard.reason, description: `Reassign "${position.title}"`, affectedIds: [positionId] };
  }

  const protectedGuard = checkProtected(position);
  if (protectedGuard.blocked) {
    return {
      positions,
      blocked: true,
      blockReason: protectedGuard.reason,
      description: `Reassign "${position.title}"`,
      affectedIds: [positionId],
    };
  }

  const cycleGuard = checkCycle(positions, positionId, newManagerId);
  if (cycleGuard.blocked) {
    return {
      positions,
      blocked: true,
      blockReason: cycleGuard.reason,
      description: `Reassign "${position.title}"`,
      affectedIds: [positionId],
    };
  }

  const next = positions.map((p) => (p.id === positionId ? { ...p, managerId: newManagerId } : p));
  const newManager = positions.find((p) => p.id === newManagerId);

  return {
    positions: next,
    blocked: false,
    description: `Reassigned "${position.title}" to report to "${newManager?.title ?? newManagerId}".`,
    affectedIds: [positionId, newManagerId],
  };
}

export function remove(positions: Position[], rootId: string | null, positionId: string): MoveOutcome {
  const position = positions.find((p) => p.id === positionId);
  if (!position) {
    return { positions, blocked: true, blockReason: "Position not found.", description: "Remove", affectedIds: [] };
  }

  const rootGuard = checkRoot(positionId, rootId);
  if (rootGuard.blocked) {
    return { positions, blocked: true, blockReason: rootGuard.reason, description: `Remove "${position.title}"`, affectedIds: [positionId] };
  }

  const syntheticGuard = checkSynthetic(position);
  if (syntheticGuard.blocked) {
    return { positions, blocked: true, blockReason: syntheticGuard.reason, description: `Remove "${position.title}"`, affectedIds: [positionId] };
  }

  const protectedGuard = checkProtected(position);
  if (protectedGuard.blocked) {
    return {
      positions,
      blocked: true,
      blockReason: protectedGuard.reason,
      description: `Remove "${position.title}"`,
      affectedIds: [positionId],
    };
  }

  // Reattach the removed position's direct reports to its own manager —
  // this is the delayering move: a role leaves, its team does not.
  const next = positions
    .filter((p) => p.id !== positionId)
    .map((p) => (p.managerId === positionId ? { ...p, managerId: position.managerId } : p));

  return {
    positions: next,
    blocked: false,
    description: `Removed "${position.title}"; its direct reports now report to its former manager.`,
    affectedIds: [positionId],
  };
}

export function add(
  positions: Position[],
  input: { title: string; department: string; managerId: string; cost: number }
): MoveOutcome {
  const manager = positions.find((p) => p.id === input.managerId);
  if (!manager) {
    return { positions, blocked: true, blockReason: "Target manager not found.", description: "Add position", affectedIds: [] };
  }

  const id = randomUUID();
  const newPosition: Position = {
    id,
    orgId: manager.orgId,
    rawName: null,
    displayName: "Vacant — new position",
    title: input.title,
    department: input.department,
    managerId: input.managerId,
    cost: input.cost,
    fte: 1,
    status: "vacant",
    clinicalFlag: false,
    sourceRowIndex: -1,
    confidence: { name: 1, title: 1, department: 1, manager: 1, classification: 1 },
    classificationSource: "fallback",
    synthetic: false,
  };

  return {
    positions: [...positions, newPosition],
    blocked: false,
    description: `Added "${input.title}" reporting to "${manager.title}".`,
    affectedIds: [id, input.managerId],
  };
}

/**
 * Rebase a position's cost and employment status without moving it in the
 * structure — the primitive behind converting agency/contract capacity to
 * permanent, where the work stays and only its price changes. Protected
 * roles are still guarded: their cost is a governance fact, not a lever.
 */
export function rebase(
  positions: Position[],
  positionId: string,
  input: { cost: number; status?: Position["status"]; reason: string }
): MoveOutcome {
  const position = positions.find((p) => p.id === positionId);
  if (!position) {
    return { positions, blocked: true, blockReason: "Position not found.", description: "Rebase", affectedIds: [] };
  }

  const syntheticGuard = checkSynthetic(position);
  if (syntheticGuard.blocked) {
    return { positions, blocked: true, blockReason: syntheticGuard.reason, description: `Rebase "${position.title}"`, affectedIds: [positionId] };
  }

  const protectedGuard = checkProtected(position);
  if (protectedGuard.blocked) {
    return {
      positions,
      blocked: true,
      blockReason: protectedGuard.reason,
      description: `Rebase "${position.title}"`,
      affectedIds: [positionId],
    };
  }

  if (input.cost >= position.cost) {
    return {
      positions,
      blocked: true,
      blockReason: `Rebasing "${position.title}" wouldn't reduce its cost — left unchanged.`,
      description: `Rebase "${position.title}"`,
      affectedIds: [positionId],
    };
  }

  const next = positions.map((p) =>
    p.id === positionId ? { ...p, cost: input.cost, status: input.status ?? p.status } : p
  );

  return {
    positions: next,
    blocked: false,
    description: `Rebased "${position.title}" from ${money(position.cost)} to ${money(input.cost)} — ${input.reason}.`,
    affectedIds: [positionId],
  };
}

const money = currency;

/** Merge a function into a shared service: graft one department's subtree root under another's. */
export function merge(positions: Position[], rootId: string | null, fromNeedle: string, intoNeedle: string): MoveOutcome {
  const intoManager = findSubject(positions, intoNeedle);

  if (!intoManager) {
    return { positions, blocked: true, blockReason: `Couldn't find a role matching "${intoNeedle}".`, description: "Merge", affectedIds: [] };
  }

  const deptRoot = findDepartmentRoot(positions, fromNeedle);

  if (!deptRoot) {
    return { positions, blocked: true, blockReason: `Couldn't find a department matching "${fromNeedle}".`, description: "Merge", affectedIds: [] };
  }

  return reassign(positions, rootId, deptRoot.id, intoManager.id);
}

/**
 * Flatten a subtree to N layers by removing the deepest intermediate
 * management layer (reattaching its reports to their grandparent),
 * repeated until the target is reached or a protected role blocks it.
 * A deliberate v1 shortcut per the scenario-model spec: deterministic
 * layer collapse, not a general redesign optimiser.
 */
export function flatten(
  positions: Position[],
  rootId: string | null,
  subjectNeedle: string,
  targetLayers: number
): MoveOutcome {
  const subject = findSubject(positions, subjectNeedle);
  if (!subject) {
    return { positions, blocked: true, blockReason: `Couldn't find a role or department matching "${subjectNeedle}".`, description: "Flatten", affectedIds: [] };
  }

  const subjectId = subject.id;
  let current = positions;
  const removedTitles: string[] = [];
  let blockedByProtected = false;
  const MAX_ITERATIONS = 20;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const depthFromSubject = new Map<string, number>();
    const byId = new Map(current.map((p) => [p.id, p] as const));

    function depthOf(id: string): number {
      if (depthFromSubject.has(id)) return depthFromSubject.get(id)!;
      if (id === subjectId) return 0;
      const p = byId.get(id);
      if (!p || !p.managerId) return -1;
      const parentDepth = depthOf(p.managerId);
      const d = parentDepth === -1 ? -1 : parentDepth + 1;
      depthFromSubject.set(id, d);
      return d;
    }

    const inSubtree = current.filter((p) => depthOf(p.id) >= 0);
    const maxDepth = Math.max(0, ...inSubtree.map((p) => depthOf(p.id)));
    const currentLayers = maxDepth + 1;

    if (currentLayers <= targetLayers) break;

    // Candidates: managers one level above the deepest leaves.
    const candidates = inSubtree.filter(
      (p) => depthOf(p.id) === maxDepth - 1 && current.some((c) => c.managerId === p.id)
    );

    if (candidates.length === 0) break;

    let removedOneThisPass = false;
    for (const candidate of candidates) {
      const guard = checkProtected(candidate);
      if (guard.blocked) {
        blockedByProtected = true;
        continue;
      }
      const outcome = remove(current, rootId, candidate.id);
      if (!outcome.blocked) {
        current = outcome.positions;
        removedTitles.push(candidate.title);
        removedOneThisPass = true;
      }
    }

    if (!removedOneThisPass) break;
  }

  if (removedTitles.length === 0) {
    return {
      positions,
      blocked: true,
      blockReason: blockedByProtected
        ? `Couldn't flatten "${subjectNeedle}": every candidate layer is a protected role.`
        : `"${subjectNeedle}" is already at or below ${targetLayers} layers.`,
      description: "Flatten",
      affectedIds: [subject.id],
    };
  }

  return {
    positions: current,
    blocked: false,
    description: `Flattened "${subject.title}" toward ${targetLayers} layers by removing: ${removedTitles.join(", ")}.${
      blockedByProtected ? " (Stopped short of the target — a protected role blocked further removal.)" : ""
    }`,
    affectedIds: [subject.id],
  };
}
