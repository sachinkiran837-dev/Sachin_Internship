/**
 * Calls the real `ingestFileAction` server action (the exact function the
 * UploadForm's <form action> wires to) with a Node FormData, bypassing only
 * the browser — not the app's own code path. Confirms the multipart file
 * read + redirect() control flow works, which scripts/verify-pipeline.ts
 * deliberately didn't exercise (it called the lower-level ingest functions
 * directly).
 *
 * Runs it twice: once with a single file, and once with several appended
 * under the same field name, which is how a multi-file upload actually
 * reaches the server. Run with
 * `npx tsx --env-file=.env.local scripts/verify-upload-action.ts`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ingestFileAction } from "../app/actions/ingest";
import { getBaselinePositions, getIssues, listOrgs } from "../db/repo";
import { computeMetrics } from "../lib/metrics/diagnostics";

async function loadFile(name: string): Promise<File> {
  const buffer = await readFile(path.join(process.cwd(), "db", "seed-data", name));
  return new File([buffer], name, { type: "text/csv" });
}

function csvFile(name: string, rows: Record<string, string>[]): File {
  const headers = Object.keys(rows[0]);
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const body = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => esc(r[h] ?? "")).join(",")),
  ].join("\n");
  return new File([body], name, { type: "text/csv" });
}

/** The action signals success by throwing next/navigation's redirect. */
async function runAction(formData: FormData): Promise<void> {
  const result = await ingestFileAction({ error: null }, formData).catch((err) => {
    const digest = (err as { digest?: string })?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return null;
    throw err;
  });
  if (result) throw new Error(`action returned instead of redirecting: ${result.error}`);
}

async function main() {
  // --- single file, unchanged behaviour ---------------------------------
  const before = (await listOrgs()).length;
  const single = new FormData();
  single.set("file", await loadFile("sample-establishment.csv"));
  single.set("anonymize", "on");
  single.set("useSample", "off");
  await runAction(single);

  let orgs = await listOrgs();
  if (orgs.length !== before + 1) {
    throw new Error(`expected one new org, before=${before} after=${orgs.length}`);
  }
  console.log(`1. single file → org "${orgs[orgs.length - 1].name}"`);

  // --- several files under the same field name --------------------------
  const full = await loadFile("meridian-full-establishment.csv");
  const rows = (await import("../lib/ingest/parseFile")).parseEstablishmentFile(
    "meridian-full-establishment.csv",
    Buffer.from(await full.arrayBuffer())
  ).rows;

  const multi = new FormData();
  // A roster with no cost in it at all...
  multi.append(
    "file",
    csvFile(
      "roster.csv",
      rows.map((r) => ({
        "Position ID": r["Position ID"],
        "Employee Name": r["Employee Name"],
        "Position Title": r["Position Title"],
        Department: r["Department"],
        "Manager ID": r["Manager ID"],
      }))
    )
  );
  // ...and a separate payroll file that is the only place cost exists.
  multi.append(
    "file",
    csvFile(
      "payroll.csv",
      rows.map((r) => ({
        "Staff ID": r["Position ID"],
        Remuneration: r["Fully Loaded Cost"],
      }))
    )
  );
  multi.set("anonymize", "on");
  multi.set("useSample", "off");

  const beforeMulti = (await listOrgs()).length;
  await runAction(multi);

  orgs = await listOrgs();
  if (orgs.length !== beforeMulti + 1) {
    throw new Error(`expected one new org from the multi-file upload, got ${orgs.length - beforeMulti}`);
  }

  const org = orgs[orgs.length - 1];
  const positions = await getBaselinePositions(org.id);
  const rootId = positions.find((p) => p.managerId === null)?.id ?? null;
  const metrics = computeMetrics(positions, rootId);

  console.log(`2. two files  → org "${org.name}"`);
  console.log(`   sourceFilename recorded as: ${org.sourceFilename}`);
  console.log(
    `   ${metrics.headcount} positions · $${metrics.totalCost.toLocaleString()} · ${metrics.layers} layers`
  );

  // The point of the test: cost came from a different file than the roster,
  // so a non-zero total proves the join happened through the real action.
  if (metrics.totalCost <= 0) {
    throw new Error("cost is zero — the payroll file did not bind to the roster");
  }
  if (metrics.headcount < 100) {
    throw new Error(`expected the full roster, got ${metrics.headcount} positions`);
  }

  const bindingNotes = (await getIssues(org.id)).filter((i) => i.kind === "conversion");
  if (bindingNotes.length < 3) {
    throw new Error(`expected a summary plus one note per file, got ${bindingNotes.length}`);
  }
  for (const n of bindingNotes) console.log(`   · ${n.detail}`);

  console.log("PASSED");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
