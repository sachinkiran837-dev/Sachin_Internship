"use server";

import { redirect } from "next/navigation";
import { createNamedScenario } from "@/db/repo";
import { applyPlayAction } from "@/lib/scenario/mutate";
import { getPlay } from "@/lib/scenario/plays";

export async function createScenarioAction(orgId: string, formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim() || "Untitled scenario";
  const scenario = await createNamedScenario(orgId, name);
  redirect(`/org/${orgId}/scenarios/${scenario.id}`);
}

export interface RunPlayState {
  error: string | null;
}

/**
 * Runs one named play into its own scenario, so each play produces a
 * comparable, independently reviewable option rather than stacking onto
 * whatever was modelled before it.
 */
export async function runPlayAction(
  orgId: string,
  _prevState: RunPlayState,
  formData: FormData
): Promise<RunPlayState> {
  const playId = String(formData.get("playId") ?? "");
  const play = getPlay(playId);
  if (!play) return { error: `Unknown play "${playId}".` };

  const scenario = await createNamedScenario(orgId, play.name);
  const result = await applyPlayAction(orgId, playId, scenario.id);

  if (result.blocked) {
    return { error: result.blockReason ?? "This play could not be applied." };
  }

  redirect(`/org/${orgId}/scenarios/${scenario.id}`);
}

/**
 * Layers a play onto a scenario that already has moves in it — the
 * combined-redesign path, as opposed to runPlayAction's one-play-per-option
 * comparison path.
 */
export async function layerPlayAction(
  orgId: string,
  scenarioId: string,
  _prevState: RunPlayState,
  formData: FormData
): Promise<RunPlayState> {
  const playId = String(formData.get("playId") ?? "");
  if (!getPlay(playId)) return { error: `Unknown play "${playId}".` };

  const result = await applyPlayAction(orgId, playId, scenarioId);
  if (result.blocked) {
    return { error: result.blockReason ?? "This play could not be applied." };
  }

  redirect(`/org/${orgId}/scenarios/${scenarioId}`);
}
