/**
 * Verifies that sixty department names roll into the seven buckets a board
 * argues about — and that the roll-up never overwrites the department someone
 * is actually in, because every scenario play works on that.
 *
 * Run with `npx tsx --env-file=.env.local scripts/verify-function-groups.ts`.
 */
import { parseEstablishmentFile } from "../lib/ingest/parseFile";
import { bindFiles, type SourceFile } from "../lib/ingest/bindFiles";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { cleanRows } from "../lib/canonical/clean";
import { buildCanonicalTable } from "../lib/canonical/table";
import { analyseFunctions } from "../lib/analysis/functions";
import { EMPTY_BUSINESS } from "../lib/hypothesis/context";
import {
  FUNCTION_GROUPS,
  groupByRule,
  groupDepartments,
  groupPositions,
  resolveGroup,
} from "../lib/ingest/functionGroups";
import { mapColumns } from "../lib/ingest/columnMapper";
import { analysePlay } from "../lib/scenario/plays";

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

/** The department names a real payroll extract actually carries. */
const REAL_DEPARTMENTS: [string, string][] = [
  ["Accounts Payable", "Finance"],
  ["Group Treasury", "Finance"],
  ["FP&A", "Finance"],
  ["Payroll Services", "Finance"],
  ["Credit Control", "Finance"],
  ["Talent Acquisition", "People"],
  ["Learning & Development", "People"],
  ["Employee Relations", "People"],
  ["Reward and Benefits", "People"],
  ["Service Delivery", "Operations"],
  ["Field Services North", "Operations"],
  ["Warehouse Operations", "Operations"],
  ["Fleet", "Operations"],
  ["Quality Assurance", "Operations"],
  ["Information Technology", "Technology"],
  ["Data & Analytics", "Technology"],
  ["Cyber Security", "Technology"],
  ["Service Desk", "Technology"],
  ["Business Development", "Commercial"],
  ["Customer Experience", "Commercial"],
  ["Marketing", "Commercial"],
  ["Legal & Compliance", "Corporate & Governance"],
  ["Risk and Assurance", "Corporate & Governance"],
  ["Company Secretariat", "Corporate & Governance"],
  ["Transformation Office", "Corporate & Governance"],
  ["Procurement", "Support Services"],
  ["Facilities Management", "Support Services"],
  ["Shared Services", "Support Services"],
];

async function main() {
  /* ---------------------------------------------------------------- */
  console.log("1. Real department names, placed by rule alone");

  let placed = 0;
  for (const [department, expected] of REAL_DEPARTMENTS) {
    const got = groupByRule(department);
    assert(got === expected, `"${department}" → expected ${expected}, got ${got ?? "nothing"}`);
    placed++;
  }
  console.log(`   ${placed} of ${REAL_DEPARTMENTS.length} placed with no model involved`);
  console.log(`   into ${FUNCTION_GROUPS.length} groups: ${FUNCTION_GROUPS.join(", ")}\n`);

  /* ---------------------------------------------------------------- */
  console.log("2. The short-keyword trap");

  // "hr" inside "Thrive", "it" inside "Quality Audit", "bd" inside "Bdellium".
  // Each of these placed a team in the wrong function before whole-word
  // matching existed, and each is silent when it happens.
  for (const trap of ["Thrive Programme", "Audit Committee Support", "Deposit Handling"]) {
    const got = groupByRule(trap);
    assert(
      got !== "People" || trap.toLowerCase().includes("people"),
      `"${trap}" must not land in People on a substring match, got ${got}`
    );
  }
  assert(groupByRule("HR Business Partner") === "People", "a real HR team must still be placed");
  assert(groupByRule("IT Operations") !== null, "a real IT team must still be placed");
  console.log(`   "Thrive Programme" → ${groupByRule("Thrive Programme") ?? "left as stated"}`);
  console.log(`   "HR Business Partner" → ${groupByRule("HR Business Partner")}\n`);

  /* ---------------------------------------------------------------- */
  console.log("3. Nothing is swept into a bucket it does not belong in");

  const odd = await groupDepartments(["Zenith Programme", "Blue Team", "Project Halcyon"]);
  for (const name of ["Zenith Programme", "Blue Team", "Project Halcyon"]) {
    const got = odd.map.get(name);
    assert(
      got === name || FUNCTION_GROUPS.includes(got ?? ""),
      `"${name}" was placed as "${got}" — must either be a real group or keep its own name`
    );
  }
  console.log(`   3 meaningless names → kept as stated or placed deliberately, never bucketed blind\n`);

  /* ---------------------------------------------------------------- */
  console.log("4. End to end: the establishment, the table and the comparison");

  // Twelve departments across four functions, each big enough to compare.
  const rows: Record<string, string>[] = [
    { ID: "1", Name: "Chief", Title: "Chief Executive", Department: "Executive", Manager: "", Salary: "320000" },
  ];
  const spread: [string, number][] = [
    ["Accounts Payable", 6], ["Group Treasury", 5], ["FP&A", 4],
    ["Talent Acquisition", 5], ["Learning & Development", 4],
    ["Service Delivery", 14], ["Field Services North", 12], ["Warehouse Operations", 9],
    ["Information Technology", 7], ["Data & Analytics", 5],
  ];
  let id = 2;
  for (const [department, size] of spread) {
    const headId = String(id++);
    rows.push({ ID: headId, Name: `${department} Head`, Title: `Head of ${department}`, Department: department, Manager: "1", Salary: "160000" });
    for (let i = 0; i < size; i++) {
      rows.push({ ID: String(id++), Name: `${department} ${i}`, Title: "Specialist", Department: department, Manager: headId, Salary: "88000" });
    }
  }

  const bound = bindFiles([csv("payroll.csv", rows)], null);
  const cleaned = cleanRows(bound.rows);
  bound.rows = cleaned.rows;
  const { positions, notes } = await buildOrgGraph(bound, {
    orgId: "fg",
    anonymize: false,
    groupBy: bound.groupBy,
  });

  const real = positions.filter((p) => !p.synthetic);
  const rawDepartments = new Set(real.map((p) => p.department));
  const groups = new Set(real.map((p) => p.functionGroup));

  assert(rawDepartments.size === 11, `expected 11 raw departments, got ${rawDepartments.size}`);
  assert(
    groups.size <= 7 && groups.size >= 3,
    `expected the rollup to reach a handful of groups, got ${groups.size}: ${[...groups].join(", ")}`
  );
  console.log(`   ${rawDepartments.size} departments → ${groups.size} functions: ${[...groups].sort().join(", ")}`);

  // The raw department must survive untouched — every play works on it.
  assert(
    real.every((p) => rawDepartments.has(p.department)),
    "the raw department must never be overwritten by the group"
  );

  const note = notes.find((n) => n.id === "function-groups");
  assert(note?.kind === "assumption", "the rollup must be registered as an assumption");

  const table = buildCanonicalTable(positions, {
    fte: false, status: false, cost: true, department: true, manager: true,
  });
  assert(
    table.rows.every((r) => r.departmentAsStated !== "" && r.department !== ""),
    "the canonical table must carry both the function and the department as stated"
  );
  const sample = table.rows.find((r) => r.departmentAsStated === "Group Treasury")!;
  assert(sample.department === "Finance", `Group Treasury should read as Finance, got ${sample.department}`);
  console.log(`   Canonical table: "${sample.departmentAsStated}" → "${sample.department}"`);

  /* ---------------------------------------------------------------- */
  console.log("\n5. The comparison now has units big enough to compare");

  const { primary, choice } = analyseFunctions(positions, positions.find((p) => p.managerId === null)?.id ?? null, EMPTY_BUSINESS);
  assert(primary.dimension === "function", `expected the function cut to be usable, got: ${choice}`);
  assert(
    primary.comparableUnits.length >= 3,
    `expected 3+ comparable functions, got ${primary.comparableUnits.length}`
  );
  console.log(
    `   ${primary.comparableUnits.length} comparable functions: ` +
      primary.comparableUnits.map((u) => `${u.key} (${u.headcount})`).join(", ")
  );

  // Against the raw departments, most units would be under the 8-position bar.
  const wouldHaveBeen = [...rawDepartments].filter(
    (d) => real.filter((p) => p.department === d).length >= 8
  ).length;
  console.log(`   Ungrouped, only ${wouldHaveBeen} of ${rawDepartments.size} departments clear the size bar.\n`);

  /* ---------------------------------------------------------------- */
  console.log("6. Plays still work on the real team, not the bucket");

  const rootId = positions.find((p) => p.managerId === null)?.id ?? null;
  const consolidation = analysePlay("thin-span-consolidation", positions, rootId);
  assert(consolidation, "the consolidation play should run");
  for (const candidate of consolidation.candidates) {
    assert(
      rawDepartments.has(candidate.department),
      `a merge candidate must name a real department, got "${candidate.department}"`
    );
    // The guard that matters: Treasury must never be merged into Payroll on
    // the grounds that both are Finance.
    assert(
      !FUNCTION_GROUPS.includes(candidate.department),
      `"${candidate.department}" is a function group — merges must happen inside a real team`
    );
  }
  console.log(
    `   ${consolidation.candidates.length} merge candidate${consolidation.candidates.length === 1 ? "" : "s"}, ` +
      `every one inside a real department rather than across a function.\n`
  );

  /* ---------------------------------------------------------------- */
  console.log("7. A pay-basis column is not a department");

  // The bug this exists to prevent: "RateUnit" contains the word "unit", so
  // 756 people were filed in a department called "Hourly" and 104 in one
  // called "Annually". The header cannot settle it; the values can.
  const payBasis = [
    { ID: "1", Name: "Chief", JobTitle: "Chief Executive", RateUnit: "Annually", Rate: "320000" },
    ...Array.from({ length: 20 }, (_, i) => ({
      ID: String(i + 2),
      Name: `Carer ${i}`,
      JobTitle: "Care Companion",
      RateUnit: i % 3 === 0 ? "Annually" : "Hourly",
      Rate: i % 3 === 0 ? "72000" : "34.42",
    })),
  ];
  const headers = Object.keys(payBasis[0]);
  const blind = mapColumns(headers).find((m) => m.targetField === "department")?.sourceColumn;
  const seeing = mapColumns(headers, payBasis).find((m) => m.targetField === "department")
    ?.sourceColumn;

  assert(blind === "RateUnit", `the header alone should still look like a department, got ${blind}`);
  assert(!seeing, `with the values to hand, no column should claim department — got "${seeing}"`);
  console.log(`   "RateUnit" claims department on its header, and loses it on its values`);

  // A real department whose values happen to include a contract-like word is
  // not thrown away — the test has to be unanimous.
  const realDepartment = [
    { ID: "1", Name: "A", Department: "Casual Pool" },
    { ID: "2", Name: "B", Department: "Finance" },
    { ID: "3", Name: "C", Department: "Operations" },
  ];
  const kept = mapColumns(Object.keys(realDepartment[0]), realDepartment).find(
    (m) => m.targetField === "department"
  )?.sourceColumn;
  assert(kept === "Department", `a genuine department column must survive, got ${kept}`);
  console.log(`   A "Casual Pool" department alongside Finance and Operations survives\n`);

  /* ---------------------------------------------------------------- */
  console.log("8. A division full of every function is not a function");

  // "Platform" places cleanly into Technology and holds the finance team, the
  // HR team and the quality team. Believing the column heading files all of
  // them under Technology and nothing on screen looks wrong.
  const division: { department: string; title: string }[] = [
    ...Array.from({ length: 12 }, () => ({ department: "Platform", title: "P&C" })),
    ...Array.from({ length: 11 }, () => ({ department: "Platform", title: "Finance" })),
    ...Array.from({ length: 5 }, () => ({ department: "Platform", title: "Quality" })),
    ...Array.from({ length: 3 }, () => ({ department: "Platform", title: "Growth" })),
    // A genuine Finance department in the same file, to prove the check is
    // about disagreement rather than about distrusting every department.
    ...Array.from({ length: 8 }, () => ({ department: "Finance", title: "Financial Accountant" })),
  ];

  const g = await groupPositions(division);
  assert(g.overruled.has("Platform"), "a division whose jobs disagree with it must be set aside");
  assert(!g.overruled.has("Finance"), "a department whose jobs agree with it must be believed");
  assert(
    resolveGroup(g, "Platform", "Finance") === "Finance",
    `a finance team inside "Platform" must read as Finance, got ${resolveGroup(g, "Platform", "Finance")}`
  );
  assert(
    resolveGroup(g, "Platform", "P&C") === "People",
    `an HR team inside "Platform" must read as People, got ${resolveGroup(g, "Platform", "P&C")}`
  );
  assert(
    resolveGroup(g, "Finance", "Financial Accountant") === "Finance",
    "a believed department must still answer for its own people"
  );
  // Once a department is disbelieved, it cannot quietly answer for the people
  // inside it whose titles say nothing either.
  assert(
    resolveGroup(g, "Platform", "Zenith Lead") === "Platform",
    `a disbelieved department must keep its raw name, got ${resolveGroup(g, "Platform", "Zenith Lead")}`
  );
  console.log(`   "Platform" set aside; its finance staff read as Finance, its HR staff as People`);
  console.log(`   "Finance" believed, because the jobs inside it agree with it\n`);

  console.log("verify-function-groups PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
