"use server";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { parseEstablishmentFile, UnsupportedFileError } from "@/lib/ingest/parseFile";
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
      filename = "sample-establishment.csv";
      buffer = await readFile(
        path.join(process.cwd(), "db", "seed-data", "sample-establishment.csv")
      );
    } else {
      filename = file.name;
      buffer = Buffer.from(await file.arrayBuffer());
    }

    const parsed = parseEstablishmentFile(filename, buffer);
    const orgId = await createOrg({
      name: filename.replace(/\.(csv|xlsx|xls)$/i, ""),
      sourceFilename: filename,
      anonymized: anonymize,
    });

    const { positions, issues } = await buildOrgGraph(parsed, { orgId, anonymize });
    await savePositions(positions);
    await saveIssues(issues);

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
