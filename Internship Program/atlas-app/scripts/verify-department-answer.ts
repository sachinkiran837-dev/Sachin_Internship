/**
 * Verifies that when Atlas cannot settle which column holds the department,
 * it asks — and that the client's answer is honoured on the re-read, including
 * the answer "it is inside the job title column".
 *
 * The three ways this comes up are all real files:
 *  - no column looks like a department at all;
 *  - a column's values look like departments but its name says nothing;
 *  - a well-named column holds places or service lines, and the job titles
 *    inside it say something quite different.
 *
 * Run with `npx tsx scripts/verify-department-answer.ts`.
 */
import { parseEstablishmentFile } from "../lib/ingest/parseFile";
import { bindFiles, type SourceFile } from "../lib/ingest/bindFiles";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { buildCanonicalTable } from "../lib/canonical/table";
import {
  EMPTY_ANSWERS,
  mergeAnswers,
  NO_DEPARTMENT,
  type IngestAnswers,
} from "../lib/ingest/answers";
import { openQuestions } from "../lib/ingest/notes";

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

/** One submission from the confirm screen. */
function answer(existing: IngestAnswers, fields: Record<string, string>): IngestAnswers {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return mergeAnswers(existing, form);
}

const FILE = "roster.csv";

/**
 * A payroll extract with no department anywhere — the department lives inside
 * the job title, which is how a great many real exports arrive.
 */
const ROSTER: Record<string, string>[] = [
  { ID: "1", Name: "Chief", JobTitle: "Chief Executive", Manager: "", Salary: "300000" },
  ...Array.from({ length: 9 }, (_, i) => ({
    ID: String(i + 2),
    Name: `Finance ${i}`,
    JobTitle: "Finance Officer",
    Manager: "1",
    Salary: "72000",
  })),
  ...Array.from({ length: 9 }, (_, i) => ({
    ID: String(i + 11),
    Name: `Nurse ${i}`,
    JobTitle: "Registered Nurse",
    Manager: "1",
    Salary: "88000",
  })),
  ...Array.from({ length: 9 }, (_, i) => ({
    ID: String(i + 20),
    Name: `People ${i}`,
    JobTitle: "HR Advisor",
    Manager: "1",
    Salary: "76000",
  })),
];

async function build(answers: IngestAnswers) {
  const bound = bindFiles([csv(FILE, ROSTER)], null, answers);
  const { positions } = await buildOrgGraph(bound, {
    orgId: "dq",
    anonymize: false,
    groupBy: bound.groupBy,
  });
  const table = buildCanonicalTable(positions, {
    fte: false,
    status: false,
    cost: true,
    department: true,
    manager: true,
  });
  return { bound, positions, table };
}

async function main() {
  /* ---------------------------------------------------------------- */
  console.log("1. No department column, so Atlas asks rather than guesses");

  const first = await build(EMPTY_ANSWERS);
  const question = openQuestions(first.bound.notes ?? []).find((n) =>
    n.id.startsWith("department-column:")
  );

  assert(question, "a file with no department column must raise the question");
  assert(question.answerKind === "column", `the question must be answerable by column, got ${question.answerKind}`);
  assert(question.options.length > 1, "the client must be offered their own columns");

  const offered = question.options.map((o) => o.from);
  assert(offered.includes("JobTitle"), `the job title column must be offered, got ${offered.join(", ")}`);
  assert(offered.includes(NO_DEPARTMENT), "and an answer for a file that truly has none");
  assert(
    question.options.every((o) => o.to.length > 0),
    "every column must be shown with a sample of what is in it"
  );

  const sample = question.options.find((o) => o.from === "JobTitle")!;
  console.log(`   ${offered.length} columns offered, each with its values:`);
  console.log(`     JobTitle — ${sample.to}`);
  console.log(`     ${NO_DEPARTMENT} — ${question.options.at(-1)!.to}\n`);

  /* ---------------------------------------------------------------- */
  console.log('2. The client answers "it is in the job title column"');

  const answered = answer(EMPTY_ANSWERS, { [`department-column:${FILE}`]: "JobTitle" });
  assert(answered.departmentColumn[FILE] === "JobTitle", "the answer must be stored against the file");

  const second = await build(answered);

  // The department is now the job title, and the title is still the title —
  // one column feeding two fields rather than being consumed by one.
  const nurse = second.table.rows.find((r) => r.title === "Registered Nurse");
  assert(nurse, "the establishment must still hold the nurses");
  assert(
    nurse.departmentAsStated === "Registered Nurse",
    `the department must come from the chosen column, got "${nurse.departmentAsStated}"`
  );
  assert(nurse.title === "Registered Nurse", "and the job title must survive being used for both");
  assert(
    nurse.department === "Operations",
    `and it must roll up into a function, got "${nurse.department}"`
  );

  const finance = second.table.rows.find((r) => r.title === "Finance Officer")!;
  assert(finance.department === "Finance", `finance staff must read as Finance, got ${finance.department}`);
  const people = second.table.rows.find((r) => r.title === "HR Advisor")!;
  assert(people.department === "People", `HR staff must read as People, got ${people.department}`);

  console.log(`   Registered Nurse → department "${nurse.departmentAsStated}" → function "${nurse.department}"`);
  console.log(`   Finance Officer  → function "${finance.department}"`);
  console.log(`   HR Advisor       → function "${people.department}"`);

  // And the question is closed: it comes back as the client's own answer.
  const closed = (second.bound.notes ?? []).find((n) => n.id === `department-column:${FILE}`);
  assert(closed?.kind === "assumption", "an answered question must come back as an assumption");
  assert(closed.answeredWith === "JobTitle", `and name the client as its source, got ${closed.answeredWith}`);
  console.log(`   The question is now an assumption reading "You said: ${closed.answeredWith}"\n`);

  /* ---------------------------------------------------------------- */
  console.log('3. The client answers "there is no department in this file"');

  const none = answer(EMPTY_ANSWERS, { [`department-column:${FILE}`]: NO_DEPARTMENT });
  const third = await build(none);

  const anyDepartment = third.table.rows.some((r) => r.departmentAsStated !== "");
  assert(!anyDepartment, "no column may be read as a department once the client says there is none");
  assert(
    third.table.rows.every((r) => r.department !== ""),
    "but the function must still be read from the job titles, or the answer costs them the comparison"
  );
  const stillOpen = openQuestions(third.bound.notes ?? []).some((n) =>
    n.id.startsWith("department-column:")
  );
  assert(!stillOpen, "and the question must stop being asked");
  console.log(`   Department blank on every row, function still read from titles, question closed\n`);

  /* ---------------------------------------------------------------- */
  console.log("4. A well-named column that names places, not functions");

  // "Division" here holds service lines. It places into no function, while
  // the job titles inside it place into four — so Atlas asks rather than
  // cutting the whole comparison by a column it cannot use.
  const divisions: Record<string, string>[] = [
    { ID: "1", Name: "Chief", JobTitle: "Chief Executive", Division: "Head Office", Manager: "", Salary: "300000" },
    ...Array.from({ length: 8 }, (_, i) => ({
      ID: String(i + 2), Name: `A${i}`, JobTitle: "Finance Officer", Division: "Head Office", Manager: "1", Salary: "72000",
    })),
    ...Array.from({ length: 8 }, (_, i) => ({
      ID: String(i + 10), Name: `B${i}`, JobTitle: "Registered Nurse", Division: "Programme A", Manager: "1", Salary: "88000",
    })),
    ...Array.from({ length: 8 }, (_, i) => ({
      ID: String(i + 18), Name: `C${i}`, JobTitle: "HR Advisor", Division: "Programme B", Manager: "1", Salary: "76000",
    })),
  ];

  const bound = bindFiles([csv("payroll.csv", divisions)], null, EMPTY_ANSWERS);
  const raised = openQuestions(bound.notes ?? []).find((n) => n.id.startsWith("department-column:"));
  assert(raised, "a department column contradicted by its own job titles must be queried");
  assert(
    raised.statement.includes("Division"),
    `the question must name the column Atlas took, got: ${raised.statement}`
  );
  console.log(`   "${raised.topic}"`);
  console.log(`   ${raised.statement}\n`);

  /* ---------------------------------------------------------------- */
  console.log("5. A file Atlas can read is not queried at all");

  const clean = divisions.map((r) => ({ ...r, Division: undefined as unknown as string, Department: r.JobTitle.includes("Finance") ? "Finance" : r.JobTitle.includes("Nurse") ? "Clinical Services" : "People and Culture" }));
  const fine = bindFiles([csv("clean.csv", clean)], null, EMPTY_ANSWERS);
  const asked = openQuestions(fine.notes ?? []).some((n) => n.id.startsWith("department-column:"));
  assert(!asked, "a plainly-named department column of real department names must not raise a question");
  console.log(`   A "Department" column of real department names: no question raised\n`);

  console.log("verify-department-answer PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
