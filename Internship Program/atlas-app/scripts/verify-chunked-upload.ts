/**
 * Verifies the path that lets an upload exceed what one HTTP request can
 * carry: a file is staged in pieces, the ingest action is handed only the
 * ids, and it reassembles them.
 *
 * The failure this is really guarding against is a *silently truncated*
 * file. Half a spreadsheet still parses — into a plausible establishment
 * that is quietly missing people — so an incomplete upload must be refused,
 * not read.
 *
 * Run with `npx tsx --env-file=.env.local scripts/verify-chunked-upload.ts`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { CHUNK_BYTES, MAX_UPLOAD_BYTES } from "../lib/ingest/formats";
import { ingestFileAction } from "../app/actions/ingest";
import {
  deleteUploads,
  getBaselinePositions,
  getIssues,
  listOrgs,
  loadUpload,
  saveUploadChunk,
} from "../db/repo";
import { computeMetrics } from "../lib/metrics/diagnostics";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

/** What the browser does in lib/ingest/uploadClient.ts, without the browser. */
async function stage(filename: string, buffer: Buffer, opts: { skipLast?: boolean } = {}) {
  const uploadId = randomUUID();
  const chunkCount = Math.max(1, Math.ceil(buffer.byteLength / CHUNK_BYTES));
  const upTo = opts.skipLast ? chunkCount - 1 : chunkCount;

  for (let i = 0; i < upTo; i++) {
    await saveUploadChunk({
      uploadId,
      filename,
      chunkIndex: i,
      chunkCount,
      data: buffer.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES).toString("base64"),
    });
  }
  return { uploadId, chunkCount };
}

async function runAction(formData: FormData): Promise<void> {
  const result = await ingestFileAction({ error: null }, formData).catch((err) => {
    const digest = (err as { digest?: string })?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return null;
    throw err;
  });
  if (result) throw new Error(`action returned instead of redirecting: ${result.error}`);
}

async function main() {
  const csv = await readFile(
    path.join(process.cwd(), "db", "seed-data", "meridian-full-establishment.csv")
  );

  // A file large enough to need several chunks, built by repeating the demo
  // establishment's rows so it stays a valid CSV.
  const [header, ...rows] = csv.toString("utf8").trim().split("\n");
  const repeats = Math.ceil((CHUNK_BYTES * 2.5) / csv.byteLength);
  const wide: string[] = [header];
  for (let r = 0; r < repeats; r++) {
    for (const row of rows) {
      const cols = row.split(",");
      cols[0] = `${cols[0]}-r${r}`; // keep position ids unique across repeats
      if (cols[4]) cols[4] = cols[4] ? `${cols[4]}-r${r}` : cols[4];
      wide.push(cols.join(","));
    }
  }
  const big = Buffer.from(wide.join("\n"), "utf8");

  console.log(
    `Fixture: ${(big.byteLength / (1024 * 1024)).toFixed(2)}MB, ${wide.length - 1} rows → ` +
      `${Math.ceil(big.byteLength / CHUNK_BYTES)} chunks of ${(CHUNK_BYTES / 1024).toFixed(0)}KB\n`
  );
  assert(big.byteLength > CHUNK_BYTES * 2, "the fixture must need more than two chunks");

  // --- 1. a staged file reassembles byte-for-byte -----------------------
  const { uploadId, chunkCount } = await stage("large-establishment.csv", big);
  const restored = await loadUpload(uploadId);
  assert(restored !== null, "a complete upload must reassemble");
  assert(restored.filename === "large-establishment.csv", "the filename must survive staging");
  assert(
    restored.buffer.equals(big),
    `reassembled ${restored.buffer.byteLength} bytes, expected ${big.byteLength}`
  );
  console.log(`1. ${chunkCount} chunks → reassembled byte-for-byte (${restored.buffer.byteLength} bytes)`);

  // --- 2. an incomplete upload is refused, not truncated ----------------
  const partial = await stage("interrupted.csv", big, { skipLast: true });
  const half = await loadUpload(partial.uploadId);
  assert(half === null, "an upload missing a chunk must not reassemble into a partial file");
  await deleteUploads([partial.uploadId]);
  console.log(`2. one chunk missing → refused rather than silently truncated`);

  // --- 3. the real action ingests from ids alone ------------------------
  const before = (await listOrgs()).length;
  const form = new FormData();
  form.append("uploadId", uploadId);
  form.set("anonymize", "on");
  form.set("useSample", "off");
  await runAction(form);

  const orgs = await listOrgs();
  assert(orgs.length === before + 1, "the staged upload should have produced one org");

  const org = orgs[orgs.length - 1];
  const positions = await getBaselinePositions(org.id);
  const rootId = positions.find((p) => p.managerId === null)?.id ?? null;
  const metrics = computeMetrics(positions, rootId);

  console.log(
    `3. action from uploadId alone → "${org.name}": ${metrics.headcount} positions · ` +
      `$${metrics.totalCost.toLocaleString()} · ${metrics.layers} layers`
  );
  // Every row is accounted for: kept, or reported as a duplicate. The demo
  // establishment contains one deliberate duplicate id, so repeating it
  // produces one reported duplicate per repeat — nothing may go missing
  // without being named.
  const dropped = (await getIssues(org.id)).filter((i) => i.kind === "duplicate").length;
  assert(
    metrics.headcount + dropped === wide.length - 1,
    `${wide.length - 1} rows in, ${metrics.headcount} kept + ${dropped} reported = ${metrics.headcount + dropped}`
  );
  assert(dropped === repeats, `expected one reported duplicate per repeat, got ${dropped}`);
  assert(metrics.totalCost > 0, "cost must have survived a chunked upload");
  console.log(`   every row accounted for: ${metrics.headcount} kept + ${dropped} reported duplicates`);

  // --- 4. the staged bytes are cleared once used ------------------------
  assert((await loadUpload(uploadId)) === null, "chunks must be deleted after the ingest reads them");
  console.log(`4. staged chunks cleared after ingest`);

  // --- 5. a missing upload is reported, not ignored ---------------------
  const ghost = new FormData();
  ghost.append("uploadId", randomUUID());
  ghost.set("anonymize", "on");
  ghost.set("useSample", "off");
  const ghostResult = await ingestFileAction({ error: null }, ghost).catch(() => null);
  assert(ghostResult?.error, "an upload whose chunks are gone must return an error");
  assert(
    ghostResult.error.includes("did not arrive completely"),
    `the error must say what happened: ${ghostResult.error}`
  );
  console.log(`5. vanished upload → "${ghostResult.error.split(".")[0]}."`);

  const notes = (await getIssues(org.id)).filter((i) => i.kind === "conversion");
  console.log(`\n   · ${notes[0]?.detail.slice(0, 110)}…`);
  console.log(
    `\nCeiling: ${(MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(0)}MB per run, in ` +
      `${(CHUNK_BYTES / 1024).toFixed(0)}KB requests — no single request approaches a host body limit.`
  );

  console.log("\nALL CHUNKED-UPLOAD CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
