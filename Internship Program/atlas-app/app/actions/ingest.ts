"use server";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { runIngest } from "@/lib/ingest/run";
import { EMPTY_ANSWERS } from "@/lib/ingest/answers";
import { deleteUploads, loadUpload } from "@/db/repo";

export interface IngestActionState {
  error: string | null;
}

const SAMPLE_FILE = "meridian-full-establishment.csv";

export async function ingestFileAction(
  _prevState: IngestActionState,
  formData: FormData
): Promise<IngestActionState> {
  const anonymize = formData.get("anonymize") === "on";
  const useSample = formData.get("useSample") === "on";
  // What the person uploading said about their own files. Free text, because
  // the things that make client data messy — three brands in one export, the
  // structure living in a PDF, last year's leavers still in the roster — are
  // not expressible as checkboxes without knowing them in advance.
  const context = String(formData.get("context") ?? "").trim();
  // The second context window, and a different question entirely. The one
  // above is about reading the files; this is about the business they
  // describe — what it earns, what it is trying to reach, what leadership
  // already suspects. None of it can be read off an export, and without it
  // Atlas can count managers but cannot say whether a function is overweight,
  // because there is nothing to be overweight against.
  const hypothesis = String(formData.get("hypothesis") ?? "").trim();

  // Two ways a file can arrive. Normally the browser has already streamed it
  // to /api/upload in chunks and passes the id it was staged under, which is
  // what lets an upload exceed what one request can carry. Files attached
  // directly still work — that's the no-JavaScript path, and the one the
  // verification scripts drive.
  const uploadIds = formData
    .getAll("uploadId")
    .map(String)
    .filter((id) => id.length > 0);
  const uploaded = formData
    .getAll("file")
    .filter((f): f is File => f instanceof File && f.size > 0);

  try {
    const incoming: { filename: string; buffer: Buffer }[] = [];
    const failures: { filename: string; error: string }[] = [];

    if (useSample || (uploadIds.length === 0 && uploaded.length === 0)) {
      const buffer = await readFile(path.join(process.cwd(), "db", "seed-data", SAMPLE_FILE));
      incoming.push({ filename: SAMPLE_FILE, buffer });
    } else {
      for (const id of uploadIds) {
        const staged = await loadUpload(id);
        if (staged) {
          incoming.push(staged);
        } else {
          failures.push({
            filename: "An uploaded file",
            error:
              "This file did not arrive completely — the connection may have dropped part-way. Add it again.",
          });
        }
      }
      for (const file of uploaded) {
        incoming.push({ filename: file.name, buffer: Buffer.from(await file.arrayBuffer()) });
      }
    }

    // The staged bytes have been read into memory; nothing needs them again.
    await deleteUploads(uploadIds);

    // A first upload has no answers by definition — Atlas has not yet said
    // what it needs. Anything it can't read off the files is raised as a
    // question on the confirm screen instead of filled in with a default.
    const result = await runIngest({
      incoming,
      failures,
      context,
      hypothesis,
      anonymize,
      answers: EMPTY_ANSWERS,
    });

    if ("error" in result) return { error: result.error };

    redirect(`/org/${result.orgId}`);
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) {
      // next/navigation redirect() throws a control-flow error — let it propagate.
      throw err;
    }
    return { error: `Ingest failed: ${(err as Error).message}` };
  }
}
