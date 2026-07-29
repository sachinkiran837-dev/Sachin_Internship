/**
 * Verifies that Atlas finds the department column in whatever an
 * establishment file happens to call it — and does not find one where there
 * isn't one.
 *
 * This is the field the entire findings screen is cut by, and it is the only
 * field that cannot be identified from its header alone: its words are
 * ordinary English (unit, group, team, section, area, service) that turn up
 * inside the names of columns about something else, while the column that
 * really holds it is as often called "Directorate" or nothing meaningful at
 * all. Every case below is a shape a real client file arrived in.
 *
 * Run with `npx tsx scripts/verify-department-column.ts`.
 */
import { mapColumns } from "../lib/ingest/columnMapper";
import { detectDepartmentColumn } from "../lib/ingest/detectDepartment";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

/** n rows of the same shape, because one row of anything proves nothing. */
const rep = (n: number, row: Record<string, string>) => Array.from({ length: n }, () => row);

interface Case {
  label: string;
  rows: Record<string, string>[];
  expect: string | null;
  why: string;
}

const CASES: Case[] = [
  /* --- found by name, whatever the word ---------------------------- */
  {
    label: "Department",
    rows: [...rep(5, { Name: "A", Department: "Finance" }), ...rep(5, { Name: "B", Department: "Operations" })],
    expect: "Department",
    why: "the obvious case must keep working",
  },
  {
    label: "Division",
    rows: [...rep(5, { Name: "A", Division: "Clinical" }), ...rep(5, { Name: "B", Division: "Corporate" })],
    expect: "Division",
    why: "the word a payroll system uses as often as department",
  },
  {
    label: "Directorate",
    rows: [...rep(5, { Name: "A", Directorate: "Adult Social Care" }), ...rep(5, { Name: "B", Directorate: "Finance" })],
    expect: "Directorate",
    why: "local government and the NHS call it this",
  },
  {
    label: "Business Unit",
    rows: [...rep(5, { Name: "A", "Business Unit": "Retail Banking" }), ...rep(5, { Name: "B", "Business Unit": "Technology" })],
    expect: "Business Unit",
    why: "the corporate word",
  },
  {
    label: "Org Unit",
    rows: [...rep(5, { Name: "A", "Org Unit": "Group Treasury" }), ...rep(5, { Name: "B", "Org Unit": "HR Shared Services" })],
    expect: "Org Unit",
    why: "what SAP exports",
  },
  {
    label: "Service Line",
    rows: [...rep(5, { Name: "A", "Service Line": "Emergency Medicine" }), ...rep(5, { Name: "B", "Service Line": "Facilities" })],
    expect: "Service Line",
    why: "professional services and healthcare",
  },
  {
    label: "Faculty",
    rows: [...rep(5, { Name: "A", Faculty: "Engineering" }), ...rep(5, { Name: "B", Faculty: "Law" })],
    expect: "Faculty",
    why: "universities",
  },
  {
    label: "Depot",
    rows: [...rep(5, { Name: "A", Depot: "North" }), ...rep(5, { Name: "B", Depot: "South" })],
    expect: "Depot",
    why: "for a logistics operator the depot is the org cut, even though it is a place",
  },
  {
    label: "camelCase businessUnit",
    rows: [...rep(5, { name: "A", businessUnit: "Finance" }), ...rep(5, { name: "B", businessUnit: "Operations" })],
    expect: "businessUnit",
    why: "a JSON export names its fields this way",
  },
  {
    label: "snake_case org_unit",
    rows: [...rep(5, { name: "A", org_unit: "People" }), ...rep(5, { name: "B", org_unit: "Legal" })],
    expect: "org_unit",
    why: "a database dump names them this way",
  },
  {
    label: "One department in the whole file",
    rows: rep(20, { Name: "A", Department: "Clinical Operations" }),
    expect: "Department",
    why: "half an establishment exported from one system carries one department on every row",
  },

  /* --- found by contents, when the header says nothing -------------- */
  {
    label: "Meaningless header, real department names",
    rows: [
      ...rep(5, { Name: "A", Grp3: "Finance" }),
      ...rep(5, { Name: "B", Grp3: "Operations" }),
      ...rep(5, { Name: "C", Grp3: "Human Resources" }),
    ],
    expect: "Grp3",
    why: "no synonym list will ever reach this, and the values are unmistakable",
  },

  /* --- the ways of being wrong, each closed off -------------------- */
  {
    label: "Pay basis (the RateUnit bug)",
    rows: [...rep(5, { Name: "A", RateUnit: "Hourly" }), ...rep(5, { Name: "B", RateUnit: "Annually" })],
    expect: null,
    why: '"unit" is a department word; Hourly and Annually are not departments',
  },
  {
    label: "Pay frequency",
    rows: [...rep(5, { Name: "A", "Pay Group": "Weekly" }), ...rep(5, { Name: "B", "Pay Group": "Monthly" })],
    expect: null,
    why: '"group" is a department word too',
  },
  {
    label: "Engagement type",
    rows: [...rep(5, { Name: "A", "Employee Group": "Permanent" }), ...rep(5, { Name: "B", "Employee Group": "Casual" })],
    expect: null,
    why: "a contract type is not a part of the organisation",
  },
  {
    label: "Cost centre codes",
    rows: [...rep(5, { Name: "A", "Cost Centre": "4021" }), ...rep(5, { Name: "B", "Cost Centre": "4022" })],
    expect: null,
    why: "a code the client can read and Atlas cannot is worse on screen than a gap",
  },
  {
    label: "Identifier with a department-ish header",
    rows: Array.from({ length: 20 }, (_, i) => ({ Name: `P${i}`, "Team Member Ref": `EMP${i}` })),
    expect: null,
    why: '"team" is a department word and every value is unique',
  },
  {
    label: "Job titles are not departments",
    rows: [...rep(5, { Name: "A", "Job Title": "Finance Manager" }), ...rep(5, { Name: "B", "Job Title": "Operations Lead" })],
    expect: null,
    why: "titles place into functions beautifully and are still not where someone sits",
  },
  {
    label: "Nothing recognisable anywhere",
    rows: [...rep(5, { Name: "A", Grp3: "Alpha" }), ...rep(5, { Name: "B", Grp3: "Beta" })],
    expect: null,
    why: "a gap is honest; the nearest text column is not",
  },

  /* --- and the right one wins when several could ------------------- */
  {
    label: "Department beats Location",
    rows: [
      ...rep(5, { Name: "A", Location: "Leeds", Department: "Finance" }),
      ...rep(5, { Name: "B", Location: "Hull", Department: "Operations" }),
    ],
    expect: "Department",
    why: "where someone works is not what they do, and both match the synonym list",
  },
  {
    label: "Real names beat a better header",
    rows: [
      ...rep(5, { Name: "A", Region: "Zone 1", Grp3: "Finance" }),
      ...rep(5, { Name: "B", Region: "Zone 2", Grp3: "Operations" }),
      ...rep(5, { Name: "C", Region: "Zone 3", Grp3: "Human Resources" }),
    ],
    expect: "Grp3",
    why: "contents are stronger evidence than a weak header",
  },
];

function main() {
  let failures = 0;

  for (const { label, rows, expect, why } of CASES) {
    const got =
      mapColumns(Object.keys(rows[0]), rows).find((m) => m.targetField === "department")
        ?.sourceColumn ?? null;

    const ok = got === expect;
    if (!ok) failures++;
    console.log(
      `${ok ? "  ok  " : "  FAIL"} ${label.padEnd(38)} → ${(got ?? "(none)").padEnd(18)} ${ok ? "" : `expected ${expect ?? "(none)"}`}`
    );
    if (!ok) console.log(`         ${why}`);
  }

  assert(failures === 0, `${failures} of ${CASES.length} department columns identified wrongly`);
  console.log(`\n${CASES.length} file shapes, ${CASES.filter((c) => c.expect).length} with a department and ${CASES.filter((c) => !c.expect).length} without.`);

  /* ------------------------------------------------------------------ */
  // The detection reports how it decided, because the register has to say.
  const named = detectDepartmentColumn(
    [...rep(5, { Division: "Finance" }), ...rep(5, { Division: "Operations" })],
    ["Division"]
  );
  assert(named?.found === "both", `a well-named column of real names is found both ways, got ${named?.found}`);

  const guessed = detectDepartmentColumn(
    [...rep(5, { Grp3: "Finance" }), ...rep(5, { Grp3: "Operations" }), ...rep(5, { Grp3: "Legal" })],
    ["Grp3"]
  );
  assert(guessed?.found === "contents", `a meaningless header is found by contents, got ${guessed?.found}`);
  assert(guessed.placementRate === 1, "and every value read as a function");

  console.log("Each choice reports whether the header, the contents or both decided it.");
  console.log("\nverify-department-column PASS");
}

main();
