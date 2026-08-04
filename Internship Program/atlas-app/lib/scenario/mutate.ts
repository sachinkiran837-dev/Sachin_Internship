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
import { parseScenarioText, type ParsedMove } from "./moveParser";
import { analysePlay, getPlay } from "./plays";
import { ask, hasAI, type AiTool } from "@/lib/ai/client";

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
  who: string = DEFAULT_WHO,
  /** Stamped onto the audit trail and the returned description — visible-fallback for a move a model read rather than a regex. */
  notePrefix?: string
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
  const describe = (d: string) => (notePrefix ? `${notePrefix}${d}` : d);

  const auditEntry = {
    id: randomUUID(),
    scenarioId: scenario.id,
    positionId: outcome.affectedIds[0] ?? null,
    action: outcome.blocked ? "blocked" : "mutation",
    detail: outcome.blocked ? (outcome.blockReason ?? "Blocked") : describe(outcome.description),
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
    description: describe(outcome.description),
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
    description: describe(outcome.description),
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

const PICK_MOVE: AiTool = {
  name: "parse_move",
  description:
    "Read a plain-English scenario instruction into exactly one of Atlas's five move kinds, or say it's none of them. Extract only what the text actually names — never guess a role, unit or number that isn't stated.",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["flatten", "merge", "remove", "reassign", "add", "none"] },
      subject: { type: "string", description: "flatten only: the unit or division named." },
      layers: { type: "integer", description: "flatten only: the target layer count." },
      from: { type: "string", description: "merge only: the unit being merged away." },
      into: { type: "string", description: "merge only: the unit it merges into." },
      target: { type: "string", description: "remove/reassign only: the role named." },
      newManager: { type: "string", description: "reassign only: the new manager's role, named." },
      title: { type: "string", description: "add only: the new role's title." },
      department: { type: "string", description: "add only: the unit or manager it reports under." },
      cost: { type: "number", description: "add only: the annual cost, 0 if not stated." },
    },
    required: ["kind"],
  },
};

/**
 * The AI-shaped step in a typed scenario move, reached only once
 * `parseScenarioText`'s regex matching has already found nothing. Same
 * discipline as `hypothesis/read.ts` and Ask Atlas's `askModelForTool`: the
 * model only ever reads the sentence into one of the five kinds
 * `parseScenarioText` already knows how to build — it does not get a sixth
 * kind, and it never decides whether the move is safe. `applyMutation`'s
 * guardrail check runs on whatever comes back exactly as it runs on a
 * regex-parsed move; a model-read move is not trusted any further than a
 * typed one.
 */
async function askModelForMove(rawText: string): Promise<ParsedMove | null> {
  if (!hasAI()) return null;
  try {
    const result = await ask({
      tier: "medium",
      maxTokens: 300,
      timeoutMs: 15000,
      system:
        "You read a scenario instruction about an org chart into a structured move. You never decide whether the move should happen — only what it says.",
      prompt: rawText,
      tool: PICK_MOVE,
    });
    if (result.truncated || !result.toolInput) return null;
    const input = result.toolInput as Record<string, unknown>;
    const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string).trim() : "");

    switch (input.kind) {
      case "flatten": {
        const subject = str("subject");
        const layers = Number(input.layers);
        return subject && Number.isFinite(layers) ? { kind: "flatten", subject, layers } : null;
      }
      case "merge": {
        const from = str("from");
        const into = str("into");
        return from && into ? { kind: "merge", from, into } : null;
      }
      case "remove": {
        const target = str("target");
        return target ? { kind: "remove", target } : null;
      }
      case "reassign": {
        const target = str("target");
        const newManager = str("newManager");
        return target && newManager ? { kind: "reassign", target, newManager } : null;
      }
      case "add": {
        const title = str("title");
        const department = str("department");
        if (!title || !department) return null;
        const cost = Number(input.cost);
        return { kind: "add", title, department, managerNeedle: department, cost: Number.isFinite(cost) ? cost : 0 };
      }
      default:
        return null;
    }
  } catch {
    // Falls back to the deterministic rejection below — visible-fallback,
    // same as everywhere else a model call backs an engine decision.
    return null;
  }
}

/** Called by the scenario page's typed-move form (C5). */
export async function submitScenarioMove(
  orgId: string,
  rawText: string,
  scenarioId?: string | null
): Promise<MutationResult> {
  let parsed = parseScenarioText(rawText);
  let aiRead = false;

  if (parsed.kind === "unrecognized") {
    const modelParsed = await askModelForMove(rawText);
    if (modelParsed) {
      parsed = modelParsed;
      aiRead = true;
    }
  }

  if (parsed.kind === "unrecognized") {
    return {
      scenarioId: scenarioId ?? "",
      blocked: true,
      blockReason: hasAI()
        ? `Couldn't understand "${rawText}" — a model looked too and couldn't place it either. Try phrasing like "flatten Operations to 3 layers", "merge Finance into Shared Services", "remove <title>", "reassign <title> to <title>", or "add a <title> under <title>".`
        : `Couldn't understand "${rawText}". Try phrasing like "flatten Operations to 3 layers", "merge Finance into Shared Services", "remove <title>", "reassign <title> to <title>", or "add a <title> under <title>".`,
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
    parsed.kind,
    DEFAULT_WHO,
    aiRead ? "Model-read from your text — " : undefined
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
