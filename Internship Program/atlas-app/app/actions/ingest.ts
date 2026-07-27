"use server";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import {
  parseEstablishmentFile,
  SUPPORTED_FORMATS,
  UnsupportedFileError,
} from "@/lib/ingest/parseFile";
import { bindFiles, type SourceFile } from "@/lib/ingest/bindFiles";
import { buildOrgGraph } from "@/lib/ingest/buildGraph";
import { createOrg, saveIssues, savePositions } from "@/db/repo";

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
  const uploaded = formData
    .getAll("file")
    .filter((f): f is File => f instanceof File && f.size > 0);

  try {
    const sources: SourceFile[] = [];

    if (useSample || uploaded.length === 0) {
      const buffer = await readFile(path.join(process.cwd(), "db", "seed-data", SAMPLE_FILE));
      sources.push({ filename: SAMPLE_FILE, parsed: parseEstablishmentFile(SAMPLE_FILE, buffer) });
    } else {
      for (const file of uploaded) {
        const buffer = Buffer.from(await file.arrayBuffer());
        sources.push({ filename: file.name, parsed: parseEstablishmentFile(file.name, buffer) });
      }
    }

    // One file binds to itself, so this path is the same for one upload or
    // ten — no separate single-file branch to drift out of sync.
    const bound = bindFiles(sources);

    if (bound.rows.length === 0) {
      return {
        error:
          "None of those files could be read as a list of positions. Atlas needs at least one file with a role or job title in it, plus a position ID, name or manager to identify each row.",
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
      ...(sources.length > 1
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

    await saveIssues([...conversionIssues, ...issues]);

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

function orgNameFor(sources: SourceFile[]): string {
  const first = stripExtension(sources[0].filename);
  return sources.length === 1 ? first : `${first} + ${sources.length - 1} more`;
}

function stripExtension(filename: string): string {
  for (const { ext } of SUPPORTED_FORMATS) {
    if (filename.toLowerCase().endsWith(ext)) return filename.slice(0, -ext.length);
  }
  return filename;
}
