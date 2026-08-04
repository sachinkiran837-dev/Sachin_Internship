/**
 * Verifies that Atlas finds the two things a group client never thinks to
 * mention: which department someone sits in, whatever the column is called,
 * and which company or brand employs them, wherever that is recorded —
 * including when it is recorded nowhere but the name of a worksheet.
 *
 * Run with `npx tsx --env-file=.env.local scripts/verify-brand-and-department.ts`.
 */
import * as XLSX from "xlsx";

import { parseEstablishmentFile } from "../lib/ingest/parseFile";
import { bindFiles, type SourceFile } from "../lib/ingest/bindFiles";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { cleanRows } from "../lib/canonical/clean";
import { mapColumns } from "../lib/ingest/columnMapper";
import { detectBrandColumn } from "../lib/ingest/detectBrand";
import { buildCanonicalTable } from "../lib/canonical/table";
import { UNCLASSIFIED } from "../lib/graph/types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function toCsv(rows: Record<string, string>[]): string {
  const h = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [h.join(","), ...rows.map((r) => h.map((x) => esc(r[x] ?? "")).join(","))].join("\n");
}

const csv = (name: string, rows: Record<string, string>[]): SourceFile => ({
  filename: name,
  parsed: parseEstablishmentFile(name, Buffer.from(toCsv(rows), "utf8")),
});

/** A workbook with one sheet per trading name and the brand named nowhere else. */
function workbook(sheets: Record<string, Record<string, string>[]>): SourceFile {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
  }
  const buf = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  return { filename: "group-payroll.xlsx", parsed: parseEstablishmentFile("group-payroll.xlsx", buf) };
}

/** One trading name's establishment, under its own chief executive. */
function entity(prefix: string, extra: Record<string, string>) {
  const rows: Record<string, string>[] = [
    { ID: `${prefix}1`, Name: `${prefix} Chief`, Title: "Chief Executive",     Manager: "",          Salary: "300000" },
    { ID: `${prefix}2`, Name: `${prefix} Ops`,   Title: "Operations Director", Manager: `${prefix}1`, Salary: "200000" },
    { ID: `${prefix}3`, Name: `${prefix} Fin`,   Title: "Finance Director",    Manager: `${prefix}1`, Salary: "195000" },
    { ID: `${prefix}4`, Name: `${prefix} Mgr`,   Title: "Service Manager",     Manager: `${prefix}2`, Salary: "120000" },
    { ID: `${prefix}5`, Name: `${prefix} Lead`,  Title: "Team Lead",           Manager: `${prefix}2`, Salary: "98000"  },
    { ID: `${prefix}6`, Name: `${prefix} Co`,    Title: "Coordinator",         Manager: `${prefix}4`, Salary: "76000"  },
  ];
  return rows.map((r) => ({ ...r, ...extra }));
}

async function build(files: SourceFile[]) {
  const bound = bindFiles(files, null);
  const { rows } = cleanRows(bound.rows);
  bound.rows = rows;
  const { positions } = await buildOrgGraph(bound, {
    orgId: "bd",
    anonymize: false,
    groupBy: bound.groupBy,
  });
  return { bound, positions };
}

async function main() {
  /* ---------------------------------------------------------------- */
  console.log("1. Department, whatever the column is called");

  for (const column of ["Department", "Division", "Business Unit", "Directorate", "Cost Centre"]) {
    const mapping = mapColumns(["ID", "Name", "Title", "Manager", column]);
    const hit = mapping.find((m) => m.sourceColumn === column);
    assert(hit?.targetField === "department", `"${column}" should map to department, got ${hit?.targetField}`);
  }
  console.log("   Department · Division · Business Unit · Directorate · Cost Centre → department\n");

  // And end to end: a file whose only such column is called "Division".
  const byDivision = await build([
    csv("staff.csv", [
      ...entity("A", { Division: "Retail" }),
      ...entity("B", { Division: "Wholesale" }),
    ]),
  ]);
  const divisions = new Set(
    byDivision.positions.filter((p) => !p.synthetic).map((p) => p.department)
  );
  assert(!divisions.has(UNCLASSIFIED), "a Division column must fill department for every row");
  assert(
    divisions.has("Retail") && divisions.has("Wholesale"),
    `expected Retail and Wholesale, got ${[...divisions].join(", ")}`
  );
  console.log(`   End to end: "Division" filled department for all 12 rows → ${[...divisions].sort().join(", ")}\n`);

  /* ---------------------------------------------------------------- */
  console.log("2. Brand found without being told, from a column");

  for (const [column, label] of [
    ["Brand", "Brand"],
    ["Company", "Company"],
    ["Legal Entity", "Entity"],
    ["Employer", "Employer"],
    ["Trading Name", "Brand"],
  ] as const) {
    const rows = [
      ...entity("A", { [column]: "Northbrook" }),
      ...entity("B", { [column]: "Calder" }),
      ...entity("C", { [column]: "Weir" }),
    ];
    const detected = detectBrandColumn(rows, Object.keys(rows[0]));
    assert(detected, `"${column}" should have been detected as the brand column`);
    assert(detected.column === column, `expected ${column}, got ${detected.column}`);
    assert(detected.group.label === label, `expected label ${label}, got ${detected.group.label}`);
    assert(detected.values.length === 3, `expected 3 brands, got ${detected.values.length}`);
  }
  console.log("   Brand · Company · Legal Entity · Employer · Trading Name all recognised\n");

  /* ---------------------------------------------------------------- */
  console.log("3. It consolidates the map, with no instruction given");

  const group = await build([
    csv("group-payroll.csv", [
      ...entity("A", { Company: "Northbrook" }),
      ...entity("B", { Company: "Calder" }),
      ...entity("C", { Company: "Weir" }),
    ]),
  ]);

  assert(group.bound.groupBy?.column === "Company", "the binder should consolidate on Company");
  const headings = group.positions.filter((p) => p.synthetic);
  assert(headings.length === 4, `expected 3 company headings under one group node, got ${headings.length}`);

  // The failure this prevents: three chief executives with nothing above them.
  const roots = group.positions.filter((p) => !p.synthetic && p.managerId === null);
  assert(roots.length === 0, `no real position should be left rootless, got ${roots.length}`);

  const brandNote = group.bound.notes?.find((n) => n.id === "brand-detected");
  assert(brandNote?.kind === "assumption", "the reading must be registered as an assumption");
  console.log(`   3 companies → 3 headings under one group node, 0 competing chief executives.`);
  console.log(`   Registered: "${brandNote.topic}"\n`);

  /* ---------------------------------------------------------------- */
  console.log("4. Brand taken from worksheet names when no column carries it");

  const tabs = await build([
    workbook({
      Northbrook: entity("A", {}),
      Calder: entity("B", {}),
      Weir: entity("C", {}),
    }),
  ]);

  assert(
    tabs.bound.groupBy?.column === "Source sheet",
    `expected consolidation on the sheet name, got ${tabs.bound.groupBy?.column ?? "nothing"}`
  );
  const tabHeadings = tabs.positions.filter((p) => p.synthetic).map((p) => p.title);
  assert(
    ["Northbrook", "Calder", "Weir"].every((b) => tabHeadings.includes(b)),
    `expected a heading per sheet, got ${tabHeadings.join(", ")}`
  );
  console.log(`   One sheet per trading name → ${tabHeadings.filter((t) => t !== "Group").join(", ")}\n`);

  /* ---------------------------------------------------------------- */
  console.log("5. The canonical table tags every employee with their company");

  const table = buildCanonicalTable(group.positions, {
    fte: false,
    status: false,
    cost: true,
    department: false,
    manager: true,
  });
  const brands = new Set(table.rows.map((r) => r.brand));
  assert(table.rows.length === 18, `expected 18 people, got ${table.rows.length}`);
  assert(!brands.has(""), "every employee should carry a company");
  assert(brands.size === 3, `expected 3 companies in the table, got ${[...brands].join(", ")}`);
  console.log(`   18 of 18 rows tagged: ${[...brands].sort().join(", ")}\n`);

  /* ---------------------------------------------------------------- */
  console.log("6. What it refuses to treat as a brand");

  const refuse: [string, Record<string, string>[]][] = [
    ["a column unique per row", entity("A", {}).map((r, i) => ({ ...r, Company: `Entity ${i}` }))],
    [
      "a column that is 99% one value",
      [...entity("A", { Company: "Northbrook" }), ...entity("B", { Company: "Northbrook" })].map(
        (r, i) => (i === 0 ? { ...r, Company: "Calder" } : r)
      ),
    ],
    ["a column most rows leave blank", entity("A", {}).map((r, i) => ({ ...r, Company: i === 0 ? "Northbrook" : "" }))],
    ["no candidate column at all", entity("A", { Region: "North" })],
  ];

  for (const [why, rows] of refuse) {
    const detected = detectBrandColumn(rows, Object.keys(rows[0]));
    assert(detected === null, `should have refused ${why}, chose "${detected?.column}"`);
    console.log(`   refused: ${why}`);
  }

  /* ---------------------------------------------------------------- */
  console.log("\n7. A row with no brand at all falls back to the group's own name");

  const unbranded = [
    { ID: "X1", Name: "X Contractor", Title: "Roaming Consultant", Manager: "", Salary: "150000" },
    { ID: "X2", Name: "X Support", Title: "Shared Support Officer", Manager: "", Salary: "80000" },
  ];
  const mixed = await build([
    csv("group-payroll.csv", [
      ...entity("A", { Company: "Northbrook" }),
      ...entity("B", { Company: "Calder" }),
      ...entity("C", { Company: "Weir" }),
      ...unbranded,
    ]),
  ]);

  assert(
    mixed.bound.groupBy?.column === "Company",
    `2 blank rows among 20 is still 90% coverage — consolidation should still succeed, got ${mixed.bound.groupBy?.column ?? "nothing"}`
  );
  const topNode = mixed.positions.find((p) => p.synthetic && p.managerId === null);
  assert(topNode, "expected one top group node");
  const unbrandedPositions = mixed.positions.filter((p) => !p.synthetic && (p.rawName === "X Contractor" || p.rawName === "X Support"));
  assert(unbrandedPositions.length === 2, `expected both unbranded rows to survive ingest, got ${unbrandedPositions.length}`);
  assert(
    unbrandedPositions.every((p) => p.managerId === topNode!.id),
    "a row naming no brand should report straight to the group node, not to any named brand's heading"
  );

  const mixedTable = buildCanonicalTable(mixed.positions, {
    fte: false,
    status: false,
    cost: true,
    department: false,
    manager: true,
  });
  const unbrandedRows = mixedTable.rows.filter((r) => r.employee === "X Contractor" || r.employee === "X Support");
  assert(unbrandedRows.length === 2, `expected both unbranded rows in the canonical table, got ${unbrandedRows.length}`);
  assert(
    unbrandedRows.every((r) => r.brand === topNode!.title),
    `expected the group's own name ("${topNode!.title}") as the fallback brand, got ${unbrandedRows.map((r) => r.brand).join(", ")}`
  );
  const namedBrandRows = mixedTable.rows.filter((r) => r.employee !== "X Contractor" && r.employee !== "X Support");
  assert(
    namedBrandRows.every((r) => r.brand !== topNode!.title && r.brand !== ""),
    "rows that did name a brand must keep their own brand, never fall back to the group's name"
  );
  console.log(`   2 rows named no company → tagged "${topNode!.title}" (the group's own name), not left blank`);
  console.log(`   the other 18 keep their real brand, never overwritten by the fallback\n`);

  console.log("verify-brand-and-department PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
