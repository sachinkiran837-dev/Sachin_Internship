/**
 * Calls the real `ingestFileAction` server action (the exact function the
 * UploadForm's <form action> wires to) with a Node FormData, bypassing only
 * the browser — not the app's own code path. Confirms the multipart file
 * read + redirect() control flow works, which scripts/verify-pipeline.ts
 * deliberately didn't exercise (it called the lower-level ingest functions
 * directly).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ingestFileAction } from "../app/actions/ingest";
import { listOrgs } from "../db/repo";

async function main() {
  const buffer = await readFile(
    path.join(process.cwd(), "db", "seed-data", "sample-establishment.csv")
  );
  const file = new File([buffer], "sample-establishment.csv", { type: "text/csv" });

  const formData = new FormData();
  formData.set("file", file);
  formData.set("anonymize", "on");
  formData.set("useSample", "");

  const before = (await listOrgs()).length;

  try {
    await ingestFileAction({ error: null }, formData);
    console.log("UNEXPECTED: redirect() did not throw");
    process.exit(1);
  } catch (err) {
    const digest = (err as { digest?: string })?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
      console.log(`ingestFileAction ran to completion and redirected: ${digest}`);
    } else {
      throw err;
    }
  }

  const after = await listOrgs();
  if (after.length !== before + 1) {
    throw new Error(`expected one new org, before=${before} after=${after.length}`);
  }
  console.log(`org created via the real action: ${after[after.length - 1].name} (${after.length} total orgs)`);
  console.log("PASSED");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
