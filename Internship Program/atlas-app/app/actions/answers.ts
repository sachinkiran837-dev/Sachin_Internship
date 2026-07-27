"use server";

import { revalidatePath } from "next/cache";
import { runIngest } from "@/lib/ingest/run";
import { mergeAnswers } from "@/lib/ingest/answers";
import { getAnswers, getOrg, getSourceBlobs } from "@/db/repo";

/**
 * Answers the questions Atlas raised, and reads the establishment again with
 * them applied.
 *
 * This is the half of ingest that makes the other half honest. Atlas is free
 * to refuse to guess a client's paid hours or reconcile their brand codes
 * precisely *because* there is a way for the client to say, and for the
 * saying to reach the numbers. Without this, a refusal is just a hole.
 *
 * The answers are stored on the establishment and the original bytes are read
 * again — never patched into the saved positions. A paid-hours figure changes
 * what every hourly row costs, which changes the coverage figures and which
 * questions are still worth asking; only a re-read keeps the map, the per-file
 * report and the register describing the same thing.
 */

export interface AnswerActionState {
  error: string | null;
  ok: boolean;
}

export async function answerIngestAction(
  _prevState: AnswerActionState,
  formData: FormData
): Promise<AnswerActionState> {
  const orgId = String(formData.get("orgId") ?? "");
  if (!orgId) return { error: "No establishment to correct.", ok: false };

  try {
    const org = await getOrg(orgId);
    if (!org) return { error: "That establishment no longer exists.", ok: false };

    const blobs = await getSourceBlobs(orgId);
    if (blobs.length === 0) {
      return {
        error:
          "Atlas no longer has the files this establishment was built from, so it cannot read them again. " +
          "Upload them once more with your corrections in the instructions box.",
        ok: false,
      };
    }

    const answers = mergeAnswers(await getAnswers(orgId), formData);

    // The free-text reply is appended to the original instructions rather
    // than replacing them, so the planner sees the whole conversation: what
    // the client said about the files, then what they said about the reading.
    const context = [org.ingestContext ?? "", answers.extraContext]
      .map((s) => s.trim())
      .filter(Boolean)
      .join("\n\n");

    const result = await runIngest({
      orgId,
      incoming: blobs,
      failures: [],
      context,
      anonymize: org.anonymized,
      answers: { ...answers, extraContext: "" },
    });

    if ("error" in result) return { error: result.error, ok: false };

    revalidatePath(`/org/${orgId}`);
    return { error: null, ok: true };
  } catch (err) {
    return { error: `Re-reading the files failed: ${(err as Error).message}`, ok: false };
  }
}
