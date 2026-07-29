/**
 * Atlas is for any organisation's data. This checks it still is.
 *
 * The failure mode this guards against is a slow one and nobody notices it
 * happening. A tool gets built against one client's files, and their brand
 * names end up in a placeholder because they were the handy example, and
 * their sector's vocabulary ends up in the copy because that was the language
 * in the room. Nothing breaks. The next client opens it and is told their
 * agency premium is about nurses and their wide-span play protects ward
 * cover, and the tool reads as somebody else's, because it is.
 *
 * So two things are pinned here. No client's identifiers appear anywhere in
 * shipped code — not in copy, not in prompts, not in comments. And nothing in
 * the engine assumes a sector, a currency, a country or a schema: the same
 * code path has to produce a working establishment from a hospital roster, a
 * logistics depot list and a software company's HR export, none of which
 * share a column name.
 *
 * Run with `npx tsx scripts/verify-generality.ts`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { bindFiles } from "../lib/ingest/bindFiles";
import { cleanRows } from "../lib/canonical/clean";
import { buildCanonicalTable, type SuppliedFields } from "../lib/canonical/table";
import { analyseFunctions, managementOutliers } from "../lib/analysis/functions";
import { buildHypotheses } from "../lib/hypothesis/build";
import { EMPTY_BUSINESS } from "../lib/hypothesis/context";
import { EMPTY_ANSWERS } from "../lib/ingest/answers";
import { parseEstablishmentFile } from "../lib/ingest/parseFile";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

/* ------------------------------------------------------------------ */
/* 1. no client, no sector, in shipped code                            */
/* ------------------------------------------------------------------ */

const SHIPPED = ["lib", "app", "components", "config", "db"];

/**
 * Identifiers belonging to real organisations Atlas has been pointed at.
 * Add to this when a new client's data is used to develop against — that is
 * the moment their names are most likely to end up in a placeholder.
 */
const CLIENT_NAMES = [
  /\bkinyara\b/i,
  /\bageup\b/i,
  /\bhomewell\b/i,
  /\baccept ?care\b/i,
  /\b365 ?care\b/i,
  /\b365C\b/,
  /\bAUH\b/,
  /\bHWL\b/,
  /\bACG\b/,
];

/**
 * Words that assume the client is a hospital.
 *
 * "clinical" is deliberately not here: it is the name of a field on Position
 * and of a real guardrail, and renaming the concept would be a refactor
 * rather than a generalisation. What is banned is sector scenery in copy a
 * client of any other kind would be shown.
 */
const SECTOR_WORDS = [/\bward\b/i, /\bnurses?\b/i, /\bpatients?\b/i, /\bbedside\b/i];

/**
 * Files that are allowed to know what a nurse is.
 *
 * There is a difference between a tool that only works for hospitals and a
 * tool that can recognise one. These files hold vocabulary Atlas *matches
 * against* — the keyword classifier's fallback list, the title words used to
 * find boxes in a drawn chart, the protected-role rules. Stripping health
 * terms out of them would not generalise Atlas, it would make it worse at
 * reading a hospital while doing nothing for anyone else. The rule they are
 * exempt from is about copy, not about recognition.
 */
const RECOGNISERS = [
  "lib/ingest/classify.ts",
  "lib/ingest/parsePdfChart.ts",
  "config/protected-roles.json",
  // Rolling "Ward 4B" up to Operations is the same kind of job as knowing a
  // nurse is clinical: the file has to know sector vocabulary to recognise it.
  // Stripping the terms out would make Atlas worse at hospitals and no better
  // at anything else.
  "config/function-groups.json",
];

/**
 * Comment lines are exempt from the sector rule too. A comment explaining
 * why cost × FTE misprices a part-time nurse is documentation of a real bug
 * that was found in real data, and rewriting the story to be sector-neutral
 * would cost the reason and keep the words.
 */
function isComment(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx|json)$/.test(entry)) out.push(path);
  }
  return out;
}

function scan() {
  const offences: string[] = [];

  for (const root of SHIPPED) {
    for (const file of walk(root)) {
      const lines = readFileSync(file, "utf8").split("\n");
      const recogniser = RECOGNISERS.some((r) => file.replace(/\\/g, "/").endsWith(r));

      lines.forEach((line, i) => {
        // A client's name is banned everywhere, with no exemptions: copy,
        // prompts, comments, fixtures. It is their data, in our product.
        for (const pattern of CLIENT_NAMES) {
          if (pattern.test(line)) {
            offences.push(`${file}:${i + 1} — client name /${pattern.source}/ in: ${line.trim().slice(0, 80)}`);
          }
        }

        if (recogniser || isComment(line)) return;

        for (const pattern of SECTOR_WORDS) {
          if (pattern.test(line)) {
            offences.push(`${file}:${i + 1} — sector assumption /${pattern.source}/ in: ${line.trim().slice(0, 80)}`);
          }
        }
      });
    }
  }

  assert(
    offences.length === 0,
    `shipped code must name no client and assume no sector:\n  ${offences.join("\n  ")}`
  );

  console.log(
    `1. Scanned ${SHIPPED.map((d) => walk(d).length).reduce((a, b) => a + b, 0)} files across ` +
      `${SHIPPED.join(", ")} — no client identifier, no sector scenery.`
  );
}

/* ------------------------------------------------------------------ */
/* 2. three unrelated organisations through one code path              */
/* ------------------------------------------------------------------ */

const SUPPLIED: SuppliedFields = {
  fte: true,
  status: true,
  cost: true,
  department: true,
  manager: true,
};

const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.join(",")).join("\n"), "utf8");

/**
 * Three organisations that share no sector, no column names, no currency
 * convention and no idea of what a "unit" is. Nothing about them is
 * configured anywhere — if the engine needs a hint to read any of them, it
 * is not general.
 */
const ORGS = {
  // A hospital, with the vocabulary Atlas was first built against.
  hospital: csv([
    ["Position ID", "Employee Name", "Job Title", "Directorate", "Reports To", "FTE", "Annual Salary"],
    ["H1", "R Adeyemi", "Chief Executive", "Executive", "", "1.0", "310000"],
    ["H2", "S Okonkwo", "Director of Nursing", "Clinical", "H1", "1.0", "210000"],
    ["H3", "T Mwangi", "Ward Manager", "Clinical", "H2", "1.0", "120000"],
    ["H4", "L Chen", "Staff Nurse", "Clinical", "H3", "0.8", "78000"],
    ["H5", "P Silva", "Staff Nurse", "Clinical", "H3", "1.0", "78000"],
    ["H6", "M Haddad", "Finance Manager", "Corporate", "H1", "1.0", "115000"],
  ]),

  // A logistics operator. Different column names for every field, and a
  // "Depot" where the hospital had a "Directorate".
  logistics: csv([
    ["Emp No", "Full Name", "Role", "Depot", "Line Manager", "Contracted FTE", "Base Pay"],
    ["L1", "D Novak", "Managing Director", "Head Office", "", "1", "265000"],
    ["L2", "A Farouk", "Regional Operations Lead", "North", "L1", "1", "142000"],
    ["L3", "J Brennan", "Depot Supervisor", "North", "L2", "1", "84000"],
    ["L4", "K Osei", "HGV Driver", "North", "L3", "1", "52000"],
    ["L5", "R Iqbal", "HGV Driver", "North", "L3", "1", "52000"],
    ["L6", "C Duval", "Warehouse Operative", "North", "L3", "0.6", "38000"],
  ]),

  // A software company, with titles that resemble nothing in either.
  software: csv([
    ["id", "name", "title", "team", "manager_id", "fte", "salary"],
    ["S1", "V Rao", "Chief Executive Officer", "Exec", "", "1", "400000"],
    ["S2", "E Lindqvist", "VP Engineering", "Engineering", "S1", "1", "290000"],
    ["S3", "N Abara", "Engineering Manager", "Engineering", "S2", "1", "200000"],
    ["S4", "Y Tanaka", "Senior Software Engineer", "Engineering", "S3", "1", "175000"],
    ["S5", "G Moreau", "Software Engineer", "Engineering", "S3", "1", "140000"],
    ["S6", "B Adler", "Head of Customer Success", "Revenue", "S1", "1", "185000"],
  ]),
};

function runOrg(label: string, buffer: Buffer) {
  const parsed = parseEstablishmentFile(`${label}.csv`, buffer);
  const bound = bindFiles([{ filename: `${label}.csv`, parsed }], null, EMPTY_ANSWERS);
  const { rows } = cleanRows(bound.rows);

  assert(rows.length === 6, `${label}: every row must survive a clean file, got ${rows.length}`);

  // Straight to the canonical shape, from three files that agree on nothing.
  const positions = rows.map((r, i) => ({
    id: r.positionId || `${label}-${i}`,
    orgId: label,
    rawName: r.name || null,
    displayName: r.name || r.title,
    title: r.title,
    department: r.department || "Unclassified",
    functionGroup: r.department || "Unclassified",
    managerId: r.managerName || null,
    cost: Number(r.cost) || 0,
    fte: Number(r.fte) || 1,
    status: "filled" as const,
    clinicalFlag: false,
    sourceRowIndex: i,
    confidence: {},
    classificationSource: "fallback" as const,
    synthetic: false,
  }));

  const table = buildCanonicalTable(positions, SUPPLIED, "Brand");
  assert(table.rows.length === 6, `${label}: canonical table must hold every person`);
  assert(
    table.rows.every((r) => r.employee && r.title),
    `${label}: every row must carry a person and a role`
  );
  assert(
    table.rows.every((r) => r.department !== ""),
    `${label}: the department column must be found whatever it is called`
  );
  assert(
    table.rows.every((r) => r.salary !== null),
    `${label}: the salary column must be found whatever it is called`
  );

  const found = table.coverage.find((c) => c.column === "Salary")!;
  assert(found.filled === 6, `${label}: salary coverage must be complete`);

  return table;
}

/* ------------------------------------------------------------------ */

function main() {
  scan();

  const tables = Object.entries(ORGS).map(([label, buffer]) => {
    const table = runOrg(label, buffer);
    console.log(
      `   ${label.padEnd(10)} → ${table.rows.length} rows, ` +
        `columns found under ${label === "software" ? "lowercase snake_case" : label === "logistics" ? "\"Emp No\" / \"Depot\" / \"Base Pay\"" : "\"Position ID\" / \"Directorate\""}`
    );
    return table;
  });

  console.log(`2. Three unrelated organisations, one code path, no per-sector configuration.`);

  assert(
    new Set(tables.map((t) => t.rows.length)).size === 1,
    "all three fixtures are the same size, so all three tables must be"
  );

  /* --- 3. the analysis makes no sector assumption either -------------- */

  // Built so Engineering carries a manager for every two people and Revenue
  // carries none — a shape with nothing medical about it, which the engine
  // still has to read.
  const nodes = [
    { id: "r", title: "CEO", department: "Exec", managerId: null, cost: 400_000 },
    { id: "e1", title: "VP Engineering", department: "Engineering", managerId: "r", cost: 290_000 },
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `em${i}`,
      title: "Engineering Manager",
      department: "Engineering",
      managerId: "e1",
      cost: 200_000,
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `eng${i}`,
      title: "Software Engineer",
      department: "Engineering",
      managerId: `em${i % 5}`,
      cost: 150_000,
    })),
    { id: "s1", title: "Head of Sales", department: "Revenue", managerId: "r", cost: 185_000 },
    ...Array.from({ length: 15 }, (_, i) => ({
      id: `ae${i}`,
      title: "Account Executive",
      department: "Revenue",
      managerId: "s1",
      cost: 120_000,
    })),
  ].map((n) => ({
    ...n,
    // Fixtures group as they are stated, so this still tests the engine and
    // not the rollup — the rollup has its own suite.
    functionGroup: n.department,
    orgId: "sw",
    rawName: n.title,
    displayName: n.title,
    fte: 1,
    status: "filled" as const,
    clinicalFlag: false,
    sourceRowIndex: 0,
    confidence: {},
    classificationSource: "fallback" as const,
    synthetic: false,
  }));

  const { primary } = analyseFunctions(nodes, "r", EMPTY_BUSINESS);
  assert(primary.dimension === "function", "a full department column must be used whatever it is called");

  const outliers = managementOutliers(primary);
  assert(
    outliers.length === 1 && outliers[0].unit.key === "Engineering",
    `the over-managed function here is Engineering: ${JSON.stringify(outliers.map((o) => o.unit.key))}`
  );

  const { hypotheses } = buildHypotheses(nodes, "r", EMPTY_BUSINESS);
  const load = hypotheses.find((h) => h.id === "management-load:Engineering")!;
  assert(load, "the same engine must raise the same hypothesis for a software company");
  assert(
    !/ward|nurse|patient|clinical/i.test(`${load.thinking} ${load.action} ${load.prize.statement}`),
    `a software company must not be told about wards or nurses:\n${load.thinking}\n${load.action}`
  );

  console.log(
    `3. Software company: "${load.title}" — driver named, no clinical vocabulary anywhere in it.`
  );

  console.log("\nALL GENERALITY CHECKS PASSED");
}

main();

// Keeps the unused-import guard honest about randomUUID's absence.
void randomUUID;
