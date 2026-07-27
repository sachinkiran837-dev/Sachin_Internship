"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { Position, Move, MoveKind } from "@/lib/graph/types";
import {
  appendAuditEntry,
  getBaselinePositions,
  getBaselineRootId,
  getOrCreateActiveScenario,
  getScenario,
  saveScenarioState,
} from "@/db/repo";
import { add, flatten, merge, reassign, rebase, remove, type MoveOutcome } from "./moves";
import { parseScenarioText } from "./moveParser";
import { analysePlay, getPlay } from "./plays";

const DEFAULT_WHO = "Project Partner (local session)";

export interface MutationResult {
  scenarioId: string;
  blocked: boolean;
  blockReason?: string;
  description: string;
}

function findNeedle(positions: Position[], needle: string): Position | undefined {
  const t = needle.trim().toLowerCase();
  return positions.find(
    (p) => p.title.toLowerCase().includes(t) || p.displayName.toLowerCase().includes(t)
  );
}

/**
 * The single mutation entry point. Every edit — a map drag (C4) or a typed
 * scenario move (C5) — funnels through here: auto-create-or-append the
 * working-copy scenario, run the protect-controls guardrail before
 * mutating, apply the change, and write one audit entry. Neither surface
 * may bypass this.
 */
async function applyMutation(
  orgId: string,
  scenarioIdInput: string | null | undefined,
  runMove: (positions: Position[], rootId: string | null) => MoveOutcome,
  moveKind: MoveKind = "reassign",
  who: string = DEFAULT_WHO
): Promise<MutationResult> {
  const scenario = scenarioIdInput
    ? await getScenario(scenarioIdInput)
    : await getOrCreateActiveScenario(orgId);

  if (!scenario) {
    return { scenarioId: "", blocked: true, blockReason: "Scenario not found.", description: "" };
  }

  const baseline = await getBaselinePositions(orgId);
  const rootId = getBaselineRootId(baseline);

  const outcome = runMove(scenario.positions, rootId);

  const auditEntry = {
    id: randomUUID(),
    scenarioId: scenario.id,
    positionId: outcome.affectedIds[0] ?? null,
    action: outcome.blocked ? "blocked" : "mutation",
    detail: outcome.blocked ? (outcome.blockReason ?? "Blocked") : outcome.description,
    who,
    when: new Date().toISOString(),
  };
  await appendAuditEntry(auditEntry);

  if (outcome.blocked) {
    return {
      scenarioId: scenario.id,
      blocked: true,
      blockReason: outcome.blockReason,
      description: outcome.description,
    };
  }

  const move: Move = {
    id: randomUUID(),
    kind: moveKind,
    raw: outcome.description,
    description: outcome.description,
    blocked: false,
    appliedAt: new Date().toISOString(),
  };

  await saveScenarioState(scenario.id, outcome.positions, [...scenario.moves, move]);

  revalidatePath(`/org/${orgId}/map`);
  revalidatePath(`/org/${orgId}/scenarios/${scenario.id}`);
  revalidatePath(`/org/${orgId}/findings`);

  return {
    scenarioId: scenario.id,
    blocked: false,
    description: outcome.description,
  };
}

/** Called by the map's drag-to-reassign handler (C4). */
export async function reassignPosition(
  orgId: string,
  positionId: string,
  newManagerId: string,
  scenarioId?: string | null
): Promise<MutationResult> {
  return applyMutation(
    orgId,
    scenarioId,
    (positions, rootId) => reassign(positions, rootId, positionId, newManagerId),
    "reassign"
  );
}

/** Called by the scenario page's typed-move form (C5). */
export async function submitScenarioMove(
  orgId: string,
  rawText: string,
  scenarioId?: string | null
): Promise<MutationResult> {
  const parsed = parseScenarioText(rawText);

  if (parsed.kind === "unrecognized") {
    return {
      scenarioId: scenarioId ?? "",
      blocked: true,
      blockReason: `Couldn't understand "${rawText}". Try phrasing like "flatten Operations to 3 layers", "merge Finance into Shared Services", "remove <title>", "reassign <title> to <title>", or "add a <title> under <title>".`,
      description: "",
    };
  }

  return applyMutation(
    orgId,
    scenarioId,
    (positions, rootId) => {
    switch (parsed.kind) {
      case "flatten":
        return flatten(positions, rootId, parsed.subject, parsed.layers);
      case "merge":
        return merge(positions, rootId, parsed.from, parsed.into);
      case "remove": {
        const target = findNeedle(positions, parsed.target);
        if (!target) {
          return { positions, blocked: true, blockReason: `Couldn't find a role matching "${parsed.target}".`, description: "Remove", affectedIds: [] };
        }
        return remove(positions, rootId, target.id);
      }
      case "reassign": {
        const target = findNeedle(positions, parsed.target);
        const newManager = findNeedle(positions, parsed.newManager);
        if (!target || !newManager) {
          return {
            positions,
            blocked: true,
            blockReason: `Couldn't find ${!target ? `a role matching "${parsed.target}"` : `a role matching "${parsed.newManager}"`}.`,
            description: "Reassign",
            affectedIds: [],
          };
        }
        return reassign(positions, rootId, target.id, newManager.id);
      }
      case "add": {
        const manager = findNeedle(positions, parsed.managerNeedle);
        if (!manager) {
          return { positions, blocked: true, blockReason: `Couldn't find a role matching "${parsed.managerNeedle}".`, description: "Add", affectedIds: [] };
        }
        return add(positions, {
          title: parsed.title,
          department: manager.department,
          managerId: manager.id,
          cost: parsed.cost,
        });
      }
    }
    },
    parsed.kind
  );
}

/**
 * Runs a named redesign play (C5's option set) as one scenario move. The
 * play only *proposes* operations — each is still executed through the
 * same reassign/remove/rebase primitives, so the protected-role guardrail
 * applies per operation and a blocked one is skipped and reported rather
 * than failing the whole play.
 */
export async function applyPlayAction(
  orgId: string,
  playId: string,
  scenarioId?: string | null
): Promise<MutationResult & { appliedCount?: number; blockedCount?: number }> {
  const play = getPlay(playId);
  if (!play) {
    return { scenarioId: scenarioId ?? "", blocked: true, blockReason: `Unknown play "${playId}".`, description: "" };
  }

  let appliedCount = 0;
  let blockedCount = 0;
  const blockReasons: string[] = [];

  const result = await applyMutation(
    orgId,
    scenarioId,
    (positions, rootId) => {
      const analysis = analysePlay(playId, positions, rootId);

      if (!analysis || analysis.operations.length === 0) {
        return {
          positions,
          blocked: true,
          blockReason: `"${play.name}" found nothing left to act on in this scenario. ${analysis?.summary ?? ""}`.trim(),
          description: play.name,
          affectedIds: [],
        };
      }

      let current = positions;
      const affected: string[] = [];

      for (const op of analysis.operations) {
        // A position removed by an earlier operation in the same play is
        // simply gone — not an error worth reporting to the user.
        if (!current.some((p) => p.id === op.positionId)) continue;

        const outcome =
          op.kind === "remove"
            ? remove(current, rootId, op.positionId)
            : op.kind === "reassign"
              ? reassign(current, rootId, op.positionId, op.newManagerId)
              : rebase(current, op.positionId, { cost: op.cost, status: op.status, reason: op.reason });

        if (outcome.blocked) {
          blockedCount++;
          if (outcome.blockReason) blockReasons.push(outcome.blockReason);
          continue;
        }

        current = outcome.positions;
        affected.push(...outcome.affectedIds);
        appliedCount++;
      }

      if (appliedCount === 0) {
        return {
          positions,
          blocked: true,
          blockReason: `"${play.name}" was fully blocked by guardrails: ${blockReasons[0] ?? "every candidate is a protected role."}`,
          description: play.name,
          affectedIds: [],
        };
      }

      return {
        positions: current,
        blocked: false,
        description:
          `${play.name}: applied ${appliedCount} change${appliedCount === 1 ? "" : "s"}` +
          (blockedCount > 0 ? `, ${blockedCount} blocked by guardrails` : "") +
          `. ${analysis.summary}`,
        affectedIds: affected,
      };
    },
    "play"
  );

  return { ...result, appliedCount, blockedCount };
}

/** Called by the map's add-position control and the scenario page. */
export async function addPositionAction(
  orgId: string,
  input: { title: string; department: string; managerId: string; cost: number },
  scenarioId?: string | null
): Promise<MutationResult> {
  return applyMutation(orgId, scenarioId, (positions) => add(positions, input), "add");
}
