"use server";

import { revalidatePath } from "next/cache";
import { getBaselinePositions, getBaselineRootId, getOrg, saveBusinessContext } from "@/db/repo";
import { unitNames } from "@/lib/analysis/functions";
import { readBusinessContext } from "@/lib/hypothesis/read";
import { EMPTY_BUSINESS } from "@/lib/hypothesis/context";

/**
 * Saves the hypothesis layer and reads the figures back out of it.
 *
 * Deliberately nothing like the ingest correction path. That one re-reads the
 * uploaded bytes, because an answer about paid hours changes what every row
 * costs. This one touches no file and no position: the establishment is a fact
 * and stays exactly as it was. What changes is what Atlas is able to say about
 * it — which functions can be compared on revenue, which target the plays are
 * measured against, which of the client's own suspicions get tested.
 *
 * That separation is what makes the hypothesis layer safe to iterate on. A
 * client can revise what they said about the business four times in a meeting
 * and the map never moves.
 */

export interface HypothesisActionState {
  error: string | null;
  ok: boolean;
  /** What Atlas managed to read out of it, so the screen can say so at once. */
  summary: string | null;
}

export async function saveHypothesisAction(
  _prevState: HypothesisActionState,
  formData: FormData
): Promise<HypothesisActionState> {
  const orgId = String(formData.get("orgId") ?? "");
  if (!orgId) return { error: "No establishment to attach this to.", ok: false, summary: null };

  const raw = String(formData.get("hypothesis") ?? "").trim();

  try {
    const org = await getOrg(orgId);
    if (!org) return { error: "That establishment no longer exists.", ok: false, summary: null };

    // Clearing the box clears the layer. Keeping a stale hypothesis alive
    // after someone has emptied it would leave findings framed by a sentence
    // that is no longer on the screen.
    if (raw.length === 0) {
      await saveBusinessContext(orgId, EMPTY_BUSINESS);
      revalidatePath(`/org/${orgId}`, "layout");
      return { error: null, ok: true, summary: "Cleared. Findings are computed from your files alone." };
    }

    const positions = await getBaselinePositions(orgId);
    const business = await readBusinessContext(raw, unitNames(positions, getBaselineRootId(positions)));
    await saveBusinessContext(orgId, business);

    revalidatePath(`/org/${orgId}`, "layout");

    const read = [
      business.revenue.length > 0 && `${business.revenue.length} revenue figure${business.revenue.length === 1 ? "" : "s"}`,
      business.targets.length > 0 && `${business.targets.length} target${business.targets.length === 1 ? "" : "s"}`,
      business.beliefs.length > 0 && `${business.beliefs.length} thing${business.beliefs.length === 1 ? "" : "s"} to test`,
      business.constraints.length > 0 && `${business.constraints.length} constraint${business.constraints.length === 1 ? "" : "s"}`,
    ].filter((s): s is string => typeof s === "string");

    return {
      error: null,
      ok: true,
      summary:
        read.length > 0
          ? `Read ${read.join(", ")}. Every one is shown below with the words it came from.`
          : "Saved, but Atlas found no figures, targets or claims in it that it could test. Everything below is computed from your files alone.",
    };
  } catch (err) {
    return { error: `Saving this failed: ${(err as Error).message}`, ok: false, summary: null };
  }
}
