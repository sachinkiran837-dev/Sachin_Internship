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
import { buildOrgGraph } from "@/lib/ingest/buildGraph";
import { createOrg, saveIssues, savePositions } from "@/db/repo";

export interface IngestActionState {
  error: string | null;
}

export async function ingestFileAction(
  _prevState: IngestActionState,
  formData: FormData
): Promise<IngestActionState> {
  const anonymize = formData.get("anonymize") === "on";
  const useSample = formData.get("useSample") === "on";
  const file = formData.get("file") as File | null;

  let filename: string;
  let buffer: Buffer;

  try {
    if (useSample || !file || file.size === 0) {
      filename = "meridian-full-establishment.csv";
      buffer = await readFile(
        path.join(process.cwd(), "db", "seed-data", "meridian-full-establishment.csv")
      );
    } else {
      filename = file.name;
      buffer = Buffer.from(await file.arrayBuffer());
    }

    const parsed = parseEstablishmentFile(filename, buffer);
    const orgId = await createOrg({
      name: stripExtension(filename),
      sourceFilename: filename,
      anonymized: anonymize,
    });

    const { positions, issues } = await buildOrgGraph(parsed, { orgId, anonymize });
    await savePositions(positions);

    // The format conversion is recorded as an ingest issue so the confirm
    // screen states what Atlas did to the file — the visible-fallback rule
    // applies to normalisation too, not just the AI-shaped behaviours.
    await saveIssues([
      {
        id: randomUUID(),
        orgId,
        kind: "conversion" as const,
        positionId: null,
        detail: `${parsed.conversion.sourceFormat} source · ${parsed.conversion.detail} ${parsed.conversion.rowCount} row${
          parsed.conversion.rowCount === 1 ? "" : "s"
        } and ${parsed.headers.length} column${parsed.headers.length === 1 ? "" : "s"} read.`,
        resolved: true,
      },
      ...issues,
    ]);

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

function stripExtension(filename: string): string {
  for (const { ext } of SUPPORTED_FORMATS) {
    if (filename.toLowerCase().endsWith(ext)) return filename.slice(0, -ext.length);
  }
  return filename;
}
