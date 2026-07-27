/**
 * Reads a folder of files into an establishment, the same way the upload
 * screen does.
 *
 * This exists for working with a real client's files without committing them:
 * point it at wherever they actually live, pass the instructions you would
 * have typed into the box, and it runs the identical code path the app runs —
 * `runIngest` — so what it produces is what the app would produce, not an
 * approximation of it.
 *
 *   npx tsx --env-file=.env.local scripts/ingest-folder.ts <folder> "<instructions>" [--only a.xlsx,b.pdf]
 *
 * Add `--answers '{"hoursPerWeek":38}'` to re-read with corrections already
 * supplied, exactly as answering on the confirm screen would.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { runIngest } from "../lib/ingest/run";
import { EMPTY_ANSWERS, parseAnswers } from "../lib/ingest/answers";
import { formatFor } from "../lib/ingest/formats";
import { getBaselinePositions, getBaselineRootId, getNotes, getSourceFiles } from "../db/repo";
import { computeMetrics } from "../lib/metrics/diagnostics";

function flag(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

async function main() {
  const folder = process.argv[2];
  const context = process.argv[3] ?? "";
  if (!folder) {
    console.error('Usage: ingest-folder.ts <folder> "<instructions>" [--only a.xlsx,b.pdf]');
    process.exit(1);
  }

  const only = flag("--only")?.split(",").map((s) => s.trim());
  const answers = flag("--answers") ? parseAnswers(flag("--answers")) : EMPTY_ANSWERS;

  const names = (await readdir(folder))
    .filter((n) => !n.startsWith("~$") && !n.startsWith("."))
    .filter((n) => formatFor(n))
    .filter((n) => !only || only.includes(n))
    .sort();

  if (names.length === 0) {
    console.error(`No readable files in ${folder}.`);
    process.exit(1);
  }

  console.log(`Reading ${names.length} file(s):`);
  for (const n of names) console.log(`  · ${n}`);
  if (context) console.log(`\nInstructions: ${context}\n`);

  const incoming = await Promise.all(
    names.map(async (filename) => ({
      filename,
      buffer: await readFile(path.join(folder, filename)),
    }))
  );

  const started = Date.now();
  const result = await runIngest({ incoming, failures: [], context, anonymize: false, answers });
  if ("error" in result) {
    console.error(`\nIngest refused:\n${result.error}`);
    process.exit(1);
  }

  const { orgId } = result;
  const positions = await getBaselinePositions(orgId);
  const real = positions.filter((p) => !p.synthetic);
  const metrics = computeMetrics(positions, getBaselineRootId(positions));

  console.log(`\nBuilt in ${((Date.now() - started) / 1000).toFixed(0)}s → /org/${orgId}`);
  console.log(
    `${real.length.toLocaleString()} positions · $${Math.round(metrics.totalCost).toLocaleString()} · ` +
      `${metrics.layers} layers · avg span ${metrics.averageSpan.toFixed(1)} · ` +
      `${real.filter((p) => p.cost > 0).length.toLocaleString()} priced`
  );

  console.log(`\nFiles:`);
  for (const f of await getSourceFiles(orgId)) {
    console.log(`  [${f.role}] ${f.filename} — ${f.detail.slice(0, 160)}`);
  }

  const notes = await getNotes(orgId);
  console.log(`\nRegister (${notes.length}):`);
  for (const n of notes) {
    console.log(`\n  ${n.kind === "question" ? "ASK " : "ASSUMED"} · ${n.topic}`);
    console.log(`    ${n.statement}`);
    console.log(`    ${n.evidence}`);
    console.log(`    ${n.effect}`);
    if (n.options.length > 0) {
      for (const o of n.options) console.log(`      ${o.from} → ${o.to || "(nothing)"}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
