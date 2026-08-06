/**
 * Verifies that the finished map is checked back against the client's own org
 * chart — and, more importantly, that the check fails when it should.
 *
 * The bind-time cross-check already compares what two documents say about a
 * reporting line. This is the separate question: does the structure Atlas
 * actually built reproduce the chart? Those answers come apart whenever the
 * graph builder has to place a role rather than read its line, which is
 * exactly the case a client would never spot by eye. Run with
 * `npx tsx --env-file=.env.local scripts/verify-structure-qc.ts`.
 */
import { parseEstablishmentFile } from "../lib/ingest/parseFile";
import { bindFiles, type SourceFile } from "../lib/ingest/bindFiles";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { cleanRows } from "../lib/canonical/clean";
import { verifyStructureAgainstMap, verificationNote } from "../lib/ingest/verifyStructure";
import type { IngestPlan } from "../lib/ingest/plan";

/**
 * The instruction a client types on the upload screen — "the spreadsheet is
 * payroll, the PDF is the structure" — as the planner would have read it.
 * Stated here rather than inferred, because a CSV chart carrying a title and
 * an ID looks exactly like a position list to the binder, and correctly so.
 */
const PLAN: IngestPlan = {
  files: [
    { filename: "payroll.csv", use: "positions", reason: "The establishment.", columns: {} },
    { filename: "org-chart.csv", use: "structure", reason: "The reporting lines.", columns: {} },
  ],
  groupBy: null,
  rowFilter: null,
  functionGrouping: null,
  answers: { hoursPerWeek: null, valueMap: {} },
  notes: "",
  warnings: [],
  source: "ai",
  model: "fixture",
};

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function toCsv(rows: Record<string, string>[]): string {
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => esc(r[h] ?? "")).join(",")),
  ].join("\n");
}

function asSource(filename: string, rows: Record<string, string>[]): SourceFile {
  return { filename, parsed: parseEstablishmentFile(filename, Buffer.from(toCsv(rows), "utf8")) };
}

/** A small establishment, stated the way a payroll extract would state it. */
function payroll(overrides: Record<string, Record<string, string>> = {}) {
  const base: Record<string, string>[] = [
    { "Employee ID": "P1", "Employee Name": "Ada Ellery",   "Job Title": "Chief Executive",     "Department": "Executive",  "Reports To": "",   "Annual Salary": "310000", "FTE": "1" },
    { "Employee ID": "P2", "Employee Name": "Bo Ferrand",   "Job Title": "Operations Director", "Department": "Operations", "Reports To": "P1", "Annual Salary": "205000", "FTE": "1" },
    { "Employee ID": "P3", "Employee Name": "Cass Iwu",     "Job Title": "Finance Director",    "Department": "Finance",    "Reports To": "P1", "Annual Salary": "198000", "FTE": "1" },
    { "Employee ID": "P4", "Employee Name": "Dai Renshaw",  "Job Title": "Service Manager",     "Department": "Operations", "Reports To": "P2", "Annual Salary": "132000", "FTE": "1" },
    { "Employee ID": "P5", "Employee Name": "Eze Moulton",  "Job Title": "Service Manager",     "Department": "Operations", "Reports To": "P2", "Annual Salary": "128000", "FTE": "1" },
    { "Employee ID": "P6", "Employee Name": "Fen Alcott",   "Job Title": "Coordinator",         "Department": "Operations", "Reports To": "P4", "Annual Salary": "84000",  "FTE": "1" },
    { "Employee ID": "P7", "Employee Name": "Gil Nwachi",   "Job Title": "Coordinator",         "Department": "Operations", "Reports To": "P4", "Annual Salary": "82000",  "FTE": "1" },
    { "Employee ID": "P8", "Employee Name": "Hal Devereux", "Job Title": "Financial Analyst",   "Department": "Finance",    "Reports To": "P3", "Annual Salary": "96000",  "FTE": "1" },
  ];
  return base.map((row) => ({ ...row, ...(overrides[row["Employee ID"]] ?? {}) }));
}

/** The same organisation as a chart: who reports to whom, and nothing else. */
function chart(reportsTo: Record<string, string>) {
  return Object.entries(reportsTo).map(([id, manager]) => ({
    "Position ID": id,
    "Role": id,
    "Reports To": manager,
  }));
}

async function build(files: SourceFile[]) {
  const bound = bindFiles(files, PLAN);
  const { rows } = cleanRows(bound.rows);
  bound.rows = rows;
  const { positions } = await buildOrgGraph(bound, { orgId: "qc", anonymize: false, groupBy: null });
  return {
    verification: verifyStructureAgainstMap(bound.structureClaims, bound.rows, positions),
    positions,
  };
}

async function main() {
  /* ---------------------------------------------------------------- */
  console.log("1. A chart the establishment agrees with");

  const agreeing = chart({ P2: "P1", P3: "P1", P4: "P2", P5: "P2", P6: "P4", P7: "P4", P8: "P3" });
  const clean = await build([
    asSource("payroll.csv", payroll()),
    asSource("org-chart.csv", agreeing),
  ]);

  assert(clean.verification.claimed === 7, `expected 7 claimed lines, got ${clean.verification.claimed}`);
  assert(clean.verification.checked === 7, `expected 7 checkable, got ${clean.verification.checked}`);
  assert(
    clean.verification.verified === 7,
    `expected every line verified, got ${clean.verification.verified} — divergences: ${JSON.stringify(clean.verification.divergences)}`
  );
  assert(clean.verification.fidelity === 1, "fidelity should be 1 when the map matches the chart");

  const cleanNote = verificationNote(clean.verification);
  assert(cleanNote?.kind === "assumption", "a matching map should register as an assumption");
  console.log(`   7 of 7 lines verified against the built map — registered as an assumption.`);
  console.log(`   "${cleanNote.statement.slice(0, 96)}…"\n`);

  /* ---------------------------------------------------------------- */
  console.log("2. A chart that contradicts the map");

  // The chart moves one coordinator under the other service manager. The
  // payroll still says P4, and the payroll is what the roster carries — but
  // the chart is laid over it, so the map should follow the chart and the
  // check should confirm it did.
  const moved = chart({ P2: "P1", P3: "P1", P4: "P2", P5: "P2", P6: "P5", P7: "P4", P8: "P3" });
  const overlaid = await build([
    asSource("payroll.csv", payroll()),
    asSource("org-chart.csv", moved),
  ]);
  assert(
    overlaid.verification.verified === overlaid.verification.checked,
    "the map follows the chart where the chart is laid over the roster, so every line should still verify"
  );
  console.log(
    `   Chart overrides payroll on 1 line; map follows the chart, so ${overlaid.verification.verified} of ${overlaid.verification.checked} still verify.\n`
  );

  /* ---------------------------------------------------------------- */
  console.log("3. The case only a post-build check can catch");

  // The chart puts P6 under P9 — a manager who appears on the chart but in no
  // spreadsheet, and carries no identity the roster can match. The reference
  // is untranslatable, so the graph builder places P6 by its own rules
  // instead. The two *files* never disagreed about a line here; the built map
  // simply doesn't do what the chart says.
  const ghost = [
    ...chart({ P2: "P1", P3: "P1", P4: "P2", P5: "P2", P7: "P4", P8: "P3" }),
    { "Position ID": "P6", "Role": "P6", "Reports To": "P99" },
  ];
  const broken = await build([
    asSource("payroll.csv", payroll({ P6: { "Reports To": "" } })),
    asSource("org-chart.csv", ghost),
  ]);

  assert(
    broken.verification.unplaced >= 1,
    `expected at least one line the check could not place, got ${broken.verification.unplaced}`
  );

  const p6 = broken.positions.find((p) => p.title === "Coordinator" && p.displayName === "Fen Alcott");
  assert(p6, "P6 should still be in the establishment");
  console.log(
    `   Chart points P6 at a manager in no spreadsheet. Claimed ${broken.verification.claimed}, ` +
      `checkable ${broken.verification.checked}, unplaceable ${broken.verification.unplaced}.`
  );
  console.log(`   P6 survived the build and was placed by the graph builder, not by the chart.\n`);

  /* ---------------------------------------------------------------- */
  console.log("4. A divergence the check reports rather than repairs");

  // A chart drawn with a mistake in it: the operations director reports to a
  // service manager who reports back to them. Every line here is individually
  // plausible and the bind-time cross-check has nothing to say about it — but
  // the graph builder has to break the cycle to produce a tree at all, and
  // whichever role it lifts now sits somewhere the chart does not put it.
  // This is the failure only a post-build check can see.
  const cyclic = chart({ P2: "P4", P3: "P1", P4: "P2", P5: "P2", P6: "P4", P7: "P4", P8: "P3" });
  const broken2 = await build([
    asSource("payroll.csv", payroll()),
    asSource("org-chart.csv", cyclic),
  ]);

  assert(
    broken2.verification.divergences.length > 0,
    `expected the cycle to surface as a divergence, got none of ${broken2.verification.checked} checked`
  );
  assert(
    broken2.verification.verified < broken2.verification.checked,
    "fidelity should be below 100% when the map cannot honour the chart"
  );

  const qcNote = verificationNote(broken2.verification);
  assert(qcNote?.kind === "question", "a map that differs from the chart must be raised as a question");

  const example = broken2.verification.divergences[0];
  assert(example.why.length > 0, "every divergence must say why the map ended up elsewhere");
  console.log(
    `   Chart contains a cycle. ${broken2.verification.verified} of ${broken2.verification.checked} lines verified, ` +
      `${broken2.verification.divergences.length} divergence${broken2.verification.divergences.length === 1 ? "" : "s"} reported.`
  );
  console.log(`   "${example.who}" — map: ${example.actual} · chart: ${example.expected}`);
  console.log(`   Reason given: ${example.why}\n`);

  /* ---------------------------------------------------------------- */
  console.log("5. No chart uploaded");

  const alone = await build([asSource("payroll.csv", payroll())]);
  assert(alone.verification.claimed === 0, "nothing to check without a structure file");
  assert(verificationNote(alone.verification) === null, "and no note should be raised");
  console.log("   No structure file, no claims, no note — the check stays silent.\n");

  console.log("verify-structure-qc PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
