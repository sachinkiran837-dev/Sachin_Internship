"use server";

import { revalidatePath } from "next/cache";
import { runIngest } from "@/lib/ingest/run";
import { mergeAnswers } from "@/lib/ingest/answers";
import {
  getAnswers,
  getBusinessContext,
  getNotes,
  getOrg,
  getSourceBlobs,
  getSourceFiles,
} from "@/db/repo";

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

    // Everything Atlas concluded last time goes with the correction, so what
    // reads the client's sentence can see the reading being corrected — the
    // roles it gave each file, the questions it could not close, the values
    // it found. Without it, "the chart isn't the structure" is unanswerable.
    const [priorFiles, priorNotes, business] = await Promise.all([
      getSourceFiles(orgId),
      getNotes(orgId),
      getBusinessContext(orgId),
    ]);

    const result = await runIngest({
      orgId,
      incoming: blobs,
      failures: [],
      context,
      // Read again from the client's original words rather than carried
      // forward. A correction can merge two brands into one, and a revenue
      // figure attached to a unit that no longer exists would silently drop
      // out of every ratio on the findings screen.
      hypothesis: business.raw,
      anonymize: org.anonymized,
      answers: { ...answers, extraContext: "" },
      prior: {
        files: priorFiles.map((f) => ({
          filename: f.filename,
          role: f.role,
          detail: f.detail,
        })),
        notes: priorNotes.map((n) => ({
          kind: n.kind,
          topic: n.topic,
          statement: n.statement,
        })),
        groupValues: [],
      },
    });

    if ("error" in result) return { error: result.error, ok: false };

    revalidatePath(`/org/${orgId}`);
    return { error: null, ok: true };
  } catch (err) {
    return { error: `Re-reading the files failed: ${(err as Error).message}`, ok: false };
  }
}
