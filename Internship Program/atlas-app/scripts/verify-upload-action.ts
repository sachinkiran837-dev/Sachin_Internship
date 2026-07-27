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
import { getBaselinePositions, getIngestPlan, getIssues, getSourceFiles, listOrgs } from "../db/repo";
import { hasAI } from "../lib/ai/client";
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

  // --- a batch containing a file that can't be read ---------------------
  // The rest of the upload must still land. Refusing the whole batch over
  // one bad file is indistinguishable, to the person uploading, from
  // multi-file upload not working at all.
  const mixed = new FormData();
  mixed.append(
    "file",
    csvFile(
      "establishment.csv",
      rows.slice(0, 40).map((r) => ({
        "Position ID": r["Position ID"],
        "Employee Name": r["Employee Name"],
        "Position Title": r["Position Title"],
        Department: r["Department"],
        "Manager ID": r["Manager ID"],
        "Fully Loaded Cost": r["Fully Loaded Cost"],
      }))
    )
  );
  mixed.append("file", new File(["not a spreadsheet"], "handbook.rtf", { type: "text/rtf" }));
  mixed.set("anonymize", "on");
  mixed.set("useSample", "off");

  const beforeMixed = (await listOrgs()).length;
  await runAction(mixed);

  orgs = await listOrgs();
  if (orgs.length !== beforeMixed + 1) {
    throw new Error("a batch with one unreadable file should still produce an establishment");
  }

  const mixedOrg = orgs[orgs.length - 1];
  const mixedPositions = await getBaselinePositions(mixedOrg.id);
  if (mixedPositions.length !== 40) {
    throw new Error(`expected the readable file's 40 rows, got ${mixedPositions.length}`);
  }

  const mixedNotes = (await getIssues(mixedOrg.id)).filter((i) => i.kind === "conversion");
  const refusal = mixedNotes.find((n) => n.detail.startsWith("handbook.rtf"));
  if (!refusal) throw new Error("the unreadable file was dropped without being reported");
  if (refusal.resolved) throw new Error("an unusable file must stay flagged for review");

  console.log(`3. good + unreadable → org "${mixedOrg.name}", ${mixedPositions.length} positions kept`);
  console.log(`   · ${refusal.detail.slice(0, 120)}…`);

  // --- the per-file report the confirm screen reads ---------------------
  const report = await getSourceFiles(org.id);
  if (report.length !== 2) {
    throw new Error(`expected a report row per uploaded file, got ${report.length}`);
  }
  if (report.map((r) => r.filename).join(",") !== "roster.csv,payroll.csv") {
    throw new Error(`the report must read back in upload order, got ${report.map((r) => r.filename)}`);
  }

  const [rosterReport, payrollReport] = report;
  if (rosterReport.role !== "roster" || payrollReport.role !== "attributes") {
    throw new Error(`roles were not recorded: ${report.map((r) => `${r.filename}=${r.role}`)}`);
  }
  // The column-by-column reading is the part a client argues with, so it has
  // to survive the round trip through the database intact.
  const staffId = payrollReport.columns.find((c) => c.column === "Staff ID");
  if (staffId?.field !== "positionId") {
    throw new Error(`column readings were lost: ${JSON.stringify(payrollReport.columns)}`);
  }
  if (!payrollReport.contributedFields.includes("cost")) {
    throw new Error("the report must record that payroll.csv supplied cost");
  }
  if (payrollReport.matchedRows !== 153 || payrollReport.conflicts !== 2) {
    throw new Error(
      `join stats did not persist: matched=${payrollReport.matchedRows} conflicts=${payrollReport.conflicts}`
    );
  }

  const mixedReport = await getSourceFiles(mixedOrg.id);
  const unusableRow = mixedReport.find((r) => r.filename === "handbook.rtf");
  if (unusableRow?.role !== "unusable") {
    throw new Error("an unreadable file must still appear in the report");
  }

  console.log(
    `4. source report → ${report.length} files recorded: ` +
      report.map((r) => `${r.filename} [${r.role}, ${r.columns.length} cols]`).join(", ")
  );
  console.log(`   unreadable files are listed too: handbook.rtf [${unusableRow.role}]`);

  // --- 5. the upload instructions survive the round trip ----------------
  // The context box is only worth having if what the user typed is still
  // attached to the establishment afterwards — and if the reading of it, or
  // the reason there wasn't one, is stored beside it rather than lost.
  const INSTRUCTION =
    "These cover our three trading brands — consolidate at brand level. The structure is in the PDF.";

  const withContext = new FormData();
  withContext.set("file", await loadFile("sample-establishment.csv"));
  withContext.set("anonymize", "on");
  withContext.set("useSample", "off");
  withContext.set("context", INSTRUCTION);
  await runAction(withContext);

  orgs = await listOrgs();
  const contextOrg = orgs[orgs.length - 1];
  if (contextOrg.ingestContext !== INSTRUCTION) {
    throw new Error(`the instructions were not stored verbatim: ${contextOrg.ingestContext}`);
  }

  const storedPlan = await getIngestPlan(contextOrg.id);
  if (!storedPlan) {
    throw new Error("a context was given, so how it was read must be stored — even if it wasn't");
  }
  if (hasAI()) {
    if (storedPlan.source !== "ai") {
      throw new Error(`with a key set, the plan should have been read: ${storedPlan.source}`);
    }
    console.log(`5. instructions stored and read by ${storedPlan.model}: "${storedPlan.notes.slice(0, 90)}…"`);
  } else {
    if (storedPlan.source !== "unavailable") {
      throw new Error(`without a key, the plan must record why: ${storedPlan.source}`);
    }
    if (!storedPlan.notes.includes("ANTHROPIC_API_KEY")) {
      throw new Error(`the stored plan must say why it wasn't applied: ${storedPlan.notes}`);
    }
    console.log(
      `5. instructions stored verbatim; recorded as not applied (source="${storedPlan.source}"), ` +
        `with the reason the confirm screen shows: "${storedPlan.notes.slice(0, 72)}…"`
    );
  }

  console.log("PASSED");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
