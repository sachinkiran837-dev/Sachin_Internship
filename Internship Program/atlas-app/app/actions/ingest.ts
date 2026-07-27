"use server";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { UnsupportedFileError } from "@/lib/ingest/parseFile";
import { SUPPORTED_FORMATS } from "@/lib/ingest/formats";
import { readSourceFile } from "@/lib/ingest/readSource";
import { bindFiles, type SourceFile } from "@/lib/ingest/bindFiles";
import { buildOrgGraph } from "@/lib/ingest/buildGraph";
import { createOrg, deleteUploads, loadUpload, saveIssues, savePositions } from "@/db/repo";

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
    const sources: SourceFile[] = [];
    const incoming: { filename: string; buffer: Buffer }[] = [];

    if (useSample || (uploadIds.length === 0 && uploaded.length === 0)) {
      const buffer = await readFile(path.join(process.cwd(), "db", "seed-data", SAMPLE_FILE));
      incoming.push({ filename: SAMPLE_FILE, buffer });
    } else {
      for (const id of uploadIds) {
        const staged = await loadUpload(id);
        if (staged) {
          incoming.push(staged);
        } else {
          sources.push({
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

    // Read every file, and record a failure as a property of that file
    // rather than throwing. One unreadable file among several is not a
    // reason to refuse the rest — and to a user, a refused batch is
    // indistinguishable from multi-file upload simply not working.
    for (const { filename, buffer } of incoming) {
      try {
        sources.push({ filename, parsed: await readSourceFile(filename, buffer) });
      } catch (err) {
        if (err instanceof UnsupportedFileError) {
          sources.push({ filename, error: err.message });
        } else {
          sources.push({
            filename,
            error: `Reading this file failed: ${(err as Error).message}`,
          });
        }
      }
    }

    // The staged bytes have been read into memory; nothing needs them again.
    await deleteUploads(uploadIds);

    // One file binds to itself, so this path is the same for one upload or
    // ten — no separate single-file branch to drift out of sync.
    const bound = bindFiles(sources);

    if (bound.rows.length === 0) {
      // Every reason, not just the first — if four files failed for four
      // different reasons, one error message naming one of them sends the
      // user round the loop three more times.
      const reasons = sources.filter((s) => s.error).map((s) => `${s.filename} — ${s.error}`);

      return {
        error:
          (reasons.length > 0
            ? `${reasons.join("\n\n")}\n\n`
            : "") +
          "Atlas needs at least one file with a role or job title in it, plus a position ID, name or manager to identify each row.",
      };
    }

    const orgId = await createOrg({
      name: orgNameFor(sources),
      sourceFilename: sources.map((s) => s.filename).join(", "),
      anonymized: anonymize,
    });

    const { positions, issues } = await buildOrgGraph(bound, { orgId, anonymize });
    await savePositions(positions);

    // What Atlas did to each file — the conversion and, when there is more
    // than one, how it was bound to the others — is recorded so the confirm
    // screen can state it. A file that contributed nothing has to say so.
    const conversionIssues = [
      {
        id: randomUUID(),
        orgId,
        kind: "conversion" as const,
        positionId: null,
        detail: `${bound.conversion.sourceFormat} · ${bound.conversion.detail} ${bound.conversion.rowCount} row${
          bound.conversion.rowCount === 1 ? "" : "s"
        } and ${bound.headers.length} column${bound.headers.length === 1 ? "" : "s"} in the combined establishment.`,
        resolved: true,
      },
      // Per-file lines whenever there is more than one file, and always when
      // a file was rejected — a single refused file must never be silent
      // just because it was the only one.
      ...(sources.length > 1 || sources.some((s) => s.error)
        ? bound.bindings.map((b) => ({
            id: randomUUID(),
            orgId,
            kind: "conversion" as const,
            positionId: null,
            detail: `${b.filename} — ${b.detail}`,
            // An unusable file is a real gap the reviewer should see, not a
            // settled fact, so it stays unresolved.
            resolved: b.role !== "unusable",
          }))
        : []),
    ];

    // Rows a model transcribed from a picture are the one kind of ingest that
    // isn't a reading of someone else's export, so they land in the same
    // low-confidence queue as an unresolved reporting line.
    const reviewIssues = sources
      .filter((s) => s.parsed?.conversion.needsReview)
      .map((s) => ({
        id: randomUUID(),
        orgId,
        kind: "low_confidence" as const,
        positionId: null,
        detail: s.parsed!.conversion.needsReview!,
        resolved: false,
      }));

    await saveIssues([...conversionIssues, ...reviewIssues, ...issues]);

    redirect(`/org/${orgId}`);
  } catch (err) {
    if (err instanceof UnsupportedFileError) {
      return { error: err.message };
    }
    if (err && typeof err === "object" && "digest" in err) {
      // next/navigation redirect() throws a control-flow error — let it propagate.
      throw err;
    }
    return { error: `Ingest failed: ${(err as Error).message}` };
  }
}

/** Named after the first file that actually contributed, not the first uploaded. */
function orgNameFor(sources: SourceFile[]): string {
  const used = sources.filter((s) => s.parsed);
  const first = stripExtension((used[0] ?? sources[0]).filename);
  return used.length <= 1 ? first : `${first} + ${used.length - 1} more`;
}

function stripExtension(filename: string): string {
  for (const { ext } of SUPPORTED_FORMATS) {
    if (filename.toLowerCase().endsWith(ext)) return filename.slice(0, -ext.length);
  }
  return filename;
}
