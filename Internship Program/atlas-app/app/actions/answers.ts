"use server";

import { revalidatePath } from "next/cache";
import { runIngest } from "@/lib/ingest/run";
import { mergeAnswers } from "@/lib/ingest/answers";
import {
  getAnswers,
  getBusinessContext,
  getIngestPlan,
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
  /**
   * What the planner concluded from a free-text instruction, in its own
   * words — only set when this submission actually carried one. A re-read
   * can succeed (`ok: true`) while the sentence typed into it went nowhere:
   * no AI configured, the model failing, or nothing in it the plan schema
   * could act on. Without this, all three look identical to a client — a
   * calm checkmark next to a table that didn't move.
   */
  planNotes: string | null;
  /** False when a free-text instruction was submitted but not read at all. */
  planApplied: boolean | null;
}

export async function answerIngestAction(
  _prevState: AnswerActionState,
  formData: FormData
): Promise<AnswerActionState> {
  const orgId = String(formData.get("orgId") ?? "");
  if (!orgId) return { error: "No establishment to correct.", ok: false, planNotes: null, planApplied: null };

  try {
    const org = await getOrg(orgId);
    if (!org) {
      return { error: "That establishment no longer exists.", ok: false, planNotes: null, planApplied: null };
    }

    const blobs = await getSourceBlobs(orgId);
    if (blobs.length === 0) {
      return {
        error:
          "Atlas no longer has the files this establishment was built from, so it cannot read them again. " +
          "Upload them once more with your corrections in the instructions box.",
        ok: false,
        planNotes: null,
        planApplied: null,
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

    // Re-read from the client's own words, not carried forward as an
    // already-parsed object — a correction can merge two brands into one,
    // and a revenue figure attached to a unit that no longer exists would
    // silently drop out of every ratio on the findings screen. The
    // correction box's text is folded in here too, exactly as it already is
    // above for the column-binding instructions: this is the one free-text
    // field on the confirm screen, and a client explaining "Northbrook did
    // about forty million last year" in the same box that fixes a mis-read
    // column shouldn't have that sentence go nowhere because it landed in
    // the wrong-shaped field. `readBusinessContext` only ever extracts what
    // was actually said, so text meant for the file reading rather than the
    // business simply contributes nothing here — never a wrong guess.
    const hypothesisText = [business.raw, answers.extraContext]
      .map((s) => s.trim())
      .filter(Boolean)
      .join("\n\n");

    const result = await runIngest({
      orgId,
      incoming: blobs,
      failures: [],
      context,
      hypothesis: hypothesisText,
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

    if ("error" in result) {
      return { error: result.error, ok: false, planNotes: null, planApplied: null };
    }

    // A re-read can be triggered from the confirm screen, the canonical
    // table or the establishment map now, and it changes what every one of
    // them (plus findings and scenarios, which are cleared) would show — so
    // whichever screen the client is looking at reflects it without a full
    // reload.
    for (const path of ["", "/data", "/map", "/findings", "/scenarios", "/ask"]) {
      revalidatePath(`/org/${orgId}${path}`);
    }

    // A re-read can succeed while the sentence that triggered it went
    // nowhere — no AI configured, the model failing, nothing in it the plan
    // schema could act on. Told here in the planner's own words, exactly as
    // the confirm screen's plan report already does, so this box says the
    // same thing whichever screen it's read from rather than a blind
    // checkmark next to a table that didn't move.
    let planNotes: string | null = null;
    let planApplied: boolean | null = null;
    if (answers.extraContext.trim()) {
      const plan = await getIngestPlan(orgId);
      planApplied = plan !== null && (plan.source === "ai" || plan.source === "rules");
      planNotes = plan?.notes?.trim() || null;
    }

    return { error: null, ok: true, planNotes, planApplied };
  } catch (err) {
    return {
      error: `Re-reading the files failed: ${(err as Error).message}`,
      ok: false,
      planNotes: null,
      planApplied: null,
    };
  }
}
