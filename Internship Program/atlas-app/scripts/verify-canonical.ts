/**
 * The clean table, and what it cost to get there.
 *
 * Two things are being pinned here, and the second matters more than the
 * first.
 *
 * The table itself is easy to check: one row per person, six columns, an
 * empty cell wherever the files said nothing. What is hard — and what this
 * script exists for — is the scrub. Deleting rows from a client's data is the
 * most dangerous thing Atlas does, precisely because the result looks
 * perfect: a clean map with no sign that eleven people are missing from it.
 * So the checks run in both directions. Garbage that survives is a bug
 * (a "Grand Total" row lands in the establishment as a very expensive
 * employee), and a real person removed is a worse one — and either way, a
 * removal that isn't reported back is the worst of the three.
 *
 * Runs in memory. No database, no network, no key.
 *
 * Run with `npx tsx scripts/verify-canonical.ts`.
 */
import { randomUUID } from "node:crypto";
import { cleanRows, cleaningNote } from "../lib/canonical/clean";
import { buildCanonicalTable, toCsv, type SuppliedFields } from "../lib/canonical/table";
import type { Position } from "../lib/graph/types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

const ALL_SUPPLIED: SuppliedFields = {
  fte: true,
  status: true,
  cost: true,
  department: true,
  manager: true,
};

function pos(over: Partial<Position> & { title: string }): Position {
  return {
    id: randomUUID(),
    orgId: "fixture",
    rawName: over.title,
    displayName: over.title,
    department: "Unclassified",
    managerId: null,
    cost: 0,
    fte: 1,
    status: "filled",
    clinicalFlag: false,
    sourceRowIndex: 0,
    confidence: {},
    classificationSource: "fallback",
    synthetic: false,
    ...over,
  };
}

function main() {
  /* --- 1. the scrub removes artefacts and keeps people ----------------- */

  const raw: Record<string, string>[] = [
    { name: "Alicia Byrnes", title: "Care Companion", positionId: "W1", cost: "62000" },
    // Whitespace damage: a non-breaking space and a double space. Same person
    // as far as anyone reading is concerned, two people to a join key.
    { name: "Josephine  Sallows", title: "Care Companion", positionId: "W2", cost: "61000" },
    // Placeholders, written four ways, as real exports write them.
    { name: "Andre Jedamski", title: "Home Support Worker", positionId: "W3", cost: "N/A" },
    { name: "Alice Chama", title: "Home Support Worker", positionId: "W4", cost: "#REF!" },
    // Incomplete, but a person. Must survive — the establishment is meant to
    // show that the salary is missing.
    { name: "Priya Raman", title: "Rostering Officer", positionId: "W5", cost: "" },
    // Artefacts. Each must go.
    { name: "Grand Total", title: "", positionId: "", cost: "4200000" },
    { name: "", title: "", positionId: "", cost: "" },
    { name: "", title: "", positionId: "", cost: "99999" },
    { name: "Subtotal", title: "", positionId: "", cost: "180000" },
  ];

  const { rows, ledger } = cleanRows(raw);

  assert(ledger.rowsIn === 9, `ledger must count what arrived: ${ledger.rowsIn}`);
  assert(rows.length === 5, `5 real people must survive, got ${rows.length}`);
  assert(ledger.rowsOut === 5, "the ledger must agree with what it returned");

  const names = rows.map((r) => r.name);
  assert(!names.some((n) => /total/i.test(n)), `a totals line must not survive: ${names.join(", ")}`);
  assert(
    names.includes("Josephine Sallows"),
    `invisible whitespace must be repaired, not left: ${JSON.stringify(names)}`
  );
  assert(
    names.includes("Priya Raman"),
    "a row with a person and no salary is incomplete, not garbage — it must survive"
  );

  // A placeholder becomes empty, and an empty salary is reported as missing.
  // Reading "N/A" as a number would price a care worker at zero and quietly
  // remove them from every cost in the model.
  const andre = rows.find((r) => r.name === "Andre Jedamski")!;
  assert(andre.cost === "", `"N/A" must read as empty, got "${andre.cost}"`);
  const alice = rows.find((r) => r.name === "Alice Chama")!;
  assert(alice.cost === "", `"#REF!" must read as empty, got "${alice.cost}"`);

  // And a row with a real value and nothing identifying anyone still goes:
  // the 99999 is a number in a spreadsheet, not a salary belonging to anyone.
  assert(
    ledger.dropped.some((d) => /identifying/i.test(d.reason)),
    `an unidentifiable row must be dropped for a stated reason: ${JSON.stringify(ledger.dropped)}`
  );

  /* --- 2. nothing is removed silently ---------------------------------- */

  const scrubbed = cleaningNote(ledger)!;
  assert(scrubbed, "rows removed must always raise a note");
  assert(scrubbed.kind === "assumption", "a completed removal is an assumption, not a question");
  assert(
    scrubbed.statement.includes("4") && scrubbed.statement.includes("9"),
    `the note must say how many of how many: "${scrubbed.statement}"`
  );
  assert(
    scrubbed.evidence.includes("Grand Total"),
    `the note must show the actual rows, so the rule can be checked: "${scrubbed.evidence}"`
  );

  // A note saying "0 rows removed" is noise, and noise is what stops the ones
  // that matter from being read.
  assert(
    cleaningNote(cleanRows([{ name: "Solo", title: "Manager" }]).ledger) === null,
    "a clean file must raise no note at all"
  );

  console.log(
    `1. Scrub: ${ledger.rowsIn} rows in, ${ledger.rowsOut} out. Removed — ` +
      ledger.dropped.map((d) => `${d.count} ${d.reason.toLowerCase()}`).join("; ") +
      `.\n2. Reported back with examples, and a clean file raises nothing.`
  );

  /* --- 3. the canonical table --------------------------------------- */

  const group = pos({ title: "Kinyara Group", synthetic: true, rawName: null });
  const brand = pos({ title: "AgeUp", synthetic: true, rawName: null, managerId: group.id });
  const lead = pos({
    title: "Brand Lead",
    displayName: "Norbert Walther",
    department: "Head Office",
    managerId: brand.id,
    cost: 180_000,
  });
  const fullTime = pos({
    title: "Care Companion",
    displayName: "Alicia Byrnes",
    department: "HCP",
    managerId: lead.id,
    cost: 62_000,
  });
  const partTime = pos({
    title: "Care Companion",
    displayName: "Josephine Sallows",
    department: "HCP",
    managerId: lead.id,
    cost: 62_000,
    fte: 0.6,
  });
  const agency = pos({
    title: "Support Worker",
    displayName: "Alice Chama",
    department: "HCP",
    managerId: lead.id,
    cost: 0,
    fte: 0,
    status: "contingent",
  });
  const vacant = pos({
    title: "Rostering Officer",
    displayName: "Vacant",
    department: "",
    managerId: lead.id,
    cost: 74_000,
    status: "vacant",
  });

  const positions = [group, brand, lead, fullTime, partTime, agency, vacant];
  const table = buildCanonicalTable(positions, ALL_SUPPLIED, "Brand");

  assert(table.rows.length === 5, `headings are not people: expected 5 rows, got ${table.rows.length}`);
  assert(
    !table.rows.some((r) => r.employee === "AgeUp" || r.employee === "Kinyara Group"),
    "a brand heading must never appear as an employee"
  );

  const alicia = table.rows.find((r) => r.employee === "Alicia Byrnes")!;
  assert(alicia.brand === "AgeUp", `brand must come from the heading above: got "${alicia.brand}"`);
  assert(alicia.manager === "Norbert Walther", `manager must resolve to a name: got "${alicia.manager}"`);
  assert(alicia.department === "HCP", "department must carry through");
  assert(alicia.employmentType === "Full-time", `1.0 FTE is full-time: got ${alicia.employmentType}`);
  assert(alicia.salary === 62_000 && alicia.annualCost === 62_000, "salary and annual cost must agree at 1.0 FTE");

  const jo = table.rows.find((r) => r.employee === "Josephine Sallows")!;
  assert(jo.employmentType === "Part-time", `0.6 FTE is part-time: got ${jo.employmentType}`);
  assert(
    jo.salary === 62_000 && Math.round(jo.annualCost) === 37_200,
    `salary stays the full-time rate and annual cost is pro-rated: ${jo.salary} / ${jo.annualCost}`
  );

  const chama = table.rows.find((r) => r.employee === "Alice Chama")!;
  assert(chama.employmentType === "Agency", `0 FTE is agency: got ${chama.employmentType}`);
  assert(chama.salary === null, "an unpriced row must be null, never zero dressed as a salary");
  assert(
    chama.flags.some((f) => /salary/i.test(f)),
    `a missing salary must be flagged on the row: ${JSON.stringify(chama.flags)}`
  );

  const empty = table.rows.find((r) => r.employee === "Vacant")!;
  assert(empty.employmentType === "Vacant", `status must win over FTE: got ${empty.employmentType}`);

  const top = table.rows.find((r) => r.employee === "Norbert Walther")!;
  assert(
    top.manager === "" && top.flags.some((f) => f.includes("AgeUp")),
    `reporting into a heading is reporting to nobody, and must say so: ${JSON.stringify(top.flags)}`
  );

  /* --- 4. a gap in the files reads differently from a gap in a row ----- */

  const noFte = buildCanonicalTable(positions, { ...ALL_SUPPLIED, fte: false }, "Brand");
  const unstated = noFte.rows.find((r) => r.employee === "Alicia Byrnes")!;
  assert(
    unstated.employmentType === "Not stated",
    `with no FTE column anywhere, 1.0 is Atlas's floor and not a fact: got ${unstated.employmentType}`
  );
  assert(
    unstated.flags.some((f) => /assumed/i.test(f)),
    "and the row must say the 1.0 was assumed"
  );

  /* --- 5. the file people actually open -------------------------------- */

  const csv = toCsv(table);
  const lines = csv.split("\n");
  assert(lines.length === 6, `header plus 5 rows: got ${lines.length}`);
  assert(
    lines[0].startsWith("Employee,Job title,Department,Brand,Manager,Employment type,FTE,Salary"),
    `the six columns must come first, in order: ${lines[0]}`
  );

  // Excel treats a cell opening with = + - or @ as a formula, and client data
  // holds titles like "-Vacant-". A spreadsheet that opens on a formula error
  // is a spreadsheet nobody trusts.
  const risky = buildCanonicalTable(
    [pos({ title: "=SUM(A1)", displayName: "=SUM(A1)", managerId: null })],
    ALL_SUPPLIED
  );
  assert(
    toCsv(risky).split("\n")[1].startsWith("'=SUM"),
    `a formula-looking value must be neutralised: ${toCsv(risky).split("\n")[1]}`
  );

  console.log(
    `3. Table: ${table.rows.length} rows from ${positions.length} nodes — headings excluded, brand resolved ` +
      `from the heading above, manager resolved to a name.\n` +
      `4. Employment read from FTE and status together: ` +
      table.rows.map((r) => `${r.employee.split(" ")[0]}=${r.employmentType}`).join(", ") +
      `.\n5. CSV: six columns in order, formula-looking values neutralised.`
  );

  console.log("\nALL CANONICAL CHECKS PASSED");
}

main();
