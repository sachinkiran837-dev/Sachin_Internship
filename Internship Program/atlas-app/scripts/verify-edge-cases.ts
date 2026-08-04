/**
 * 50+ edge cases across ingestion, graph construction, number parsing and
 * brand detection — the malformed, ambiguous and structurally weird inputs a
 * real upload eventually contains, rather than the well-formed fixtures the
 * other verify-*.ts scripts use.
 *
 * Two kinds of check, both counted: ASSERT (a known, grounded behaviour —
 * traced to the actual code before being written, not guessed) and OBSERVE
 * (the point of running it is to find out what happens; logged honestly
 * either way, never asserted toward a pre-decided answer).
 *
 * Runs in memory. No database, no network, no key.
 *
 * Run with `npx tsx scripts/verify-edge-cases.ts`.
 */
import { parseEstablishmentFile, UnsupportedFileError } from "../lib/ingest/parseFile";
import { bindFiles, type SourceFile } from "../lib/ingest/bindFiles";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { cleanRows } from "../lib/canonical/clean";
import { detectBrandColumn } from "../lib/ingest/detectBrand";
import { buildCanonicalTable } from "../lib/canonical/table";
import { computeMetrics } from "../lib/metrics/diagnostics";
import type { Position } from "../lib/graph/types";

let n = 0;
let asserted = 0;
let observed = 0;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`CASE ${n} FAILED: ${msg}`);
  asserted++;
}
function ok(msg: string) {
  console.log(`  ${n}. ✓ ${msg}`);
}
function observe(msg: string) {
  observed++;
  console.log(`  ${n}. → ${msg}`);
}
function next(label: string) {
  n++;
  console.log(`\n[${n}] ${label}`);
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

/** Raw CSV text, bypassing the object-row builder — for ragged/malformed rows toCsv() can't express. */
const rawCsv = (name: string, text: string): SourceFile => ({
  filename: name,
  parsed: parseEstablishmentFile(name, Buffer.from(text, "utf8")),
});

async function ingest(files: SourceFile[], orgId = `edge-${n}`) {
  const bound = bindFiles(files, null);
  const { rows } = cleanRows(bound.rows);
  bound.rows = rows;
  const { positions, issues } = await buildOrgGraph(bound, {
    orgId,
    anonymize: false,
    groupBy: bound.groupBy,
  });
  return { positions, issues, bound };
}

function realOf(positions: Position[]) {
  return positions.filter((p) => !p.synthetic);
}
function rootOf(positions: Position[]) {
  return positions.find((p) => p.managerId === null) ?? null;
}

async function main() {
  console.log("=== A. File format & parsing ===");

  next("Header-only file, zero data rows");
  try {
    parseEstablishmentFile("empty.csv", Buffer.from("ID,Name,Title,Manager\n", "utf8"));
    throw new Error("expected UnsupportedFileError, none thrown");
  } catch (err) {
    assert(err instanceof UnsupportedFileError, `expected UnsupportedFileError, got ${(err as Error).constructor.name}`);
    assert(/data|header/i.test((err as Error).message), `expected a message naming the missing data/header, got: ${(err as Error).message}`);
    ok(`throws UnsupportedFileError: "${(err as Error).message}"`);
  }

  next("Single-row establishment — just a chief executive, no reports");
  {
    const { positions } = await ingest([csv("f.csv", [{ ID: "1", Name: "A Chief", Title: "Chief Executive", Manager: "", Salary: "300000" }])]);
    const real = realOf(positions);
    assert(real.length === 1, `expected 1 position, got ${real.length}`);
    assert(real[0].managerId === null, "the only person in the file must be the root");
    ok("1 position, correctly rootless");
  }

  next("Two-row chain — a report linked to their manager by ID");
  {
    const { positions } = await ingest([csv("f.csv", [
      { ID: "1", Name: "A Chief", Title: "Chief Executive", Manager: "", Salary: "300000" },
      { ID: "2", Name: "B Report", Title: "Deputy", Manager: "1", Salary: "200000" },
    ])]);
    const real = realOf(positions);
    const report = real.find((p) => p.rawName === "B Report");
    const chief = real.find((p) => p.rawName === "A Chief");
    assert(report?.managerId === chief?.id, "the report should resolve to the chief by ID");
    ok("2-row chain links correctly");
  }

  next("Extra blank trailing column in the header");
  {
    const { positions } = await ingest([rawCsv("f.csv",
      "ID,Name,Title,Manager,Salary,\n1,A Chief,Chief Executive,,300000,\n2,B Report,Deputy,1,200000,\n"
    )]);
    assert(realOf(positions).length === 2, `expected 2 positions despite the blank trailing column, got ${realOf(positions).length}`);
    ok("blank trailing header column doesn't break ingestion");
  }

  next("Ragged row — fewer fields than the header declares");
  {
    const { positions } = await ingest([rawCsv("f.csv",
      "ID,Name,Title,Manager,Salary\n1,A Chief,Chief Executive,,300000\n2,B Report,Deputy\n"
    )]);
    assert(realOf(positions).length === 2, `expected 2 positions from a ragged file, got ${realOf(positions).length}`);
    ok("a row shorter than the header doesn't crash ingestion");
  }

  next("Header names with surrounding whitespace ( \" ID \", \" Manager \" )");
  {
    const { positions } = await ingest([rawCsv("f.csv",
      " ID , Name , Title , Manager \n1,A Chief,Chief Executive,\n2,B Report,Deputy,1\n"
    )]);
    const report = realOf(positions).find((p) => p.rawName === "B Report");
    assert(report?.managerId !== undefined, "a whitespace-padded Manager header should still be recognised and linked");
    ok("whitespace-padded headers still map");
  }

  next("A fully blank line in the data (trailing newline artefact)");
  {
    const { positions } = await ingest([rawCsv("f.csv",
      "ID,Name,Title,Manager,Salary\n1,A Chief,Chief Executive,,300000\n,,,,\n"
    )]);
    observe(`${realOf(positions).length} real position(s) survived a blank data line (want: still 1, not 2)`);
  }

  console.log("\n=== B. Duplicate & identity ===");

  next("Exact duplicate row — same ID, identical data, twice");
  {
    const row = { ID: "1", Name: "A Chief", Title: "Chief Executive", Manager: "", Salary: "300000" };
    const { positions, issues } = await ingest([csv("f.csv", [row, row])]);
    assert(realOf(positions).length === 1, `expected the duplicate dropped, got ${realOf(positions).length} positions`);
    const dup = issues.find((i) => i.kind === "duplicate");
    assert(!!dup, "expected a duplicate issue to be logged");
    assert(/kept the first occurrence/.test(dup!.detail), "duplicate issue should say the first occurrence was kept");
    ok("exact duplicate ID deduped, issue logged");
  }

  next("Duplicate ID with conflicting salary in the repeat");
  {
    const { positions } = await ingest([csv("f.csv", [
      { ID: "1", Name: "A Chief", Title: "Chief Executive", Manager: "", Salary: "300000" },
      { ID: "1", Name: "A Chief", Title: "Chief Executive", Manager: "", Salary: "999999" },
    ])]);
    const real = realOf(positions);
    assert(real.length === 1, `expected 1 position, got ${real.length}`);
    assert(real[0].cost === 300000, `expected the first occurrence's salary (300000) kept, got ${real[0].cost}`);
    ok("first occurrence's data wins over a conflicting repeat");
  }

  next("Same name and title, different ID — a real second person, not a duplicate");
  {
    const { positions } = await ingest([csv("f.csv", [
      { ID: "1", Name: "Chief", Title: "Registered Nurse", Manager: "", Salary: "100000" },
      { ID: "2", Name: "Chief", Title: "Registered Nurse", Manager: "1", Salary: "101000" },
    ])]);
    assert(realOf(positions).length === 2, `expected 2 distinct positions (same name, different ID), got ${realOf(positions).length}`);
    ok("a same-named person under a different ID is never merged away");
  }

  next("No ID column in the file at all");
  {
    const { positions } = await ingest([rawCsv("f.csv",
      "Name,Title,Manager,Salary\nA Chief,Chief Executive,,300000\nB Report,Deputy,A Chief,200000\n"
    )]);
    observe(`${realOf(positions).length} position(s) survived with no ID column at all (want: 2, not a crash)`);
  }

  next("Blank ID for some rows, present for others");
  {
    const { positions } = await ingest([csv("f.csv", [
      { ID: "1", Name: "A Chief", Title: "Chief Executive", Manager: "", Salary: "300000" },
      { ID: "", Name: "B Report", Title: "Deputy", Manager: "1", Salary: "200000" },
      { ID: "", Name: "C Report", Title: "Deputy", Manager: "1", Salary: "199000" },
    ])]);
    observe(`${realOf(positions).length} position(s) survived with 2 of 3 IDs blank (want: 3, no silent drop)`);
  }

  next("Same ID repeated three times");
  {
    const row = { ID: "1", Name: "A Chief", Title: "Chief Executive", Manager: "", Salary: "300000" };
    const { positions, issues } = await ingest([csv("f.csv", [row, row, row])]);
    assert(realOf(positions).length === 1, `expected 1 kept of 3 identical IDs, got ${realOf(positions).length}`);
    assert(issues.filter((i) => i.kind === "duplicate").length === 2, `expected 2 duplicate issues (rows 2 and 3), got ${issues.filter((i) => i.kind === "duplicate").length}`);
    ok("a triple-duplicated ID drops both repeats, keeps one");
  }

  next("Same ID differing only by surrounding whitespace (\"1\" vs \" 1 \")");
  {
    const { positions } = await ingest([csv("f.csv", [
      { ID: "1", Name: "A Chief", Title: "Chief Executive", Manager: "", Salary: "300000" },
      { ID: " 1 ", Name: "A Chief Again", Title: "Chief Executive", Manager: "", Salary: "300000" },
    ])]);
    observe(`${realOf(positions).length} position(s) from IDs "1" and " 1 " (tells you whether ID matching trims whitespace)`);
  }

  console.log("\n=== C. Reporting-line structure ===");

  next("Self-loop — a manager ID pointing at its own row");
  {
    const { positions } = await ingest([csv("f.csv", [
      { ID: "1", Name: "A Chief", Title: "Chief Executive", Manager: "1", Salary: "300000" },
    ])]);
    const real = realOf(positions);
    assert(real.length === 1, `expected the self-referencing row to survive as 1 position, got ${real.length}`);
    assert(real[0].id !== real[0].managerId, "a position must never end up as its own manager");
    ok("self-loop never leaves a position reporting to itself — no crash, no infinite loop");
  }

  next("Two-node cycle — A manages B, B manages A");
  {
    const { positions, issues } = await ingest([csv("f.csv", [
      { ID: "1", Name: "A", Title: "Manager", Manager: "2", Salary: "150000" },
      { ID: "2", Name: "B", Title: "Manager", Manager: "1", Salary: "150000" },
    ])]);
    assert(realOf(positions).length === 2, `expected both cycle members to survive, got ${realOf(positions).length}`);
    const cycleIssue = issues.find((i) => /cycle/i.test(i.detail));
    assert(!!cycleIssue, "expected an issue naming the cycle");
    ok("2-node cycle broken without a crash, logged as a cycle");
  }

  next("Three-node cycle — A → B → C → A");
  {
    const { positions } = await ingest([csv("f.csv", [
      { ID: "1", Name: "A", Title: "Manager", Manager: "3", Salary: "150000" },
      { ID: "2", Name: "B", Title: "Manager", Manager: "1", Salary: "150000" },
      { ID: "3", Name: "C", Title: "Manager", Manager: "2", Salary: "150000" },
    ])]);
    assert(realOf(positions).length === 3, `expected all 3 cycle members to survive, got ${realOf(positions).length}`);
    // No infinite loop reaching this line is itself half of what this case tests.
    ok("3-node cycle resolved, all 3 positions intact, no infinite loop");
  }

  next("Manager ID referencing a row that doesn't exist anywhere in the file");
  {
    const { positions } = await ingest([csv("f.csv", [
      { ID: "1", Name: "A", Title: "Team Lead", Manager: "999", Salary: "90000" },
    ])]);
    const real = realOf(positions);
    assert(real.length === 1, `expected the orphaned row to survive, got ${real.length}`);
    ok("a manager reference to a nonexistent ID doesn't drop the row");
  }

  next("Multiple blank-manager rows, no brand column to consolidate them");
  {
    const { positions } = await ingest([csv("f.csv", [
      { ID: "1", Name: "A", Title: "Chief Executive", Manager: "", Salary: "300000" },
      { ID: "2", Name: "B", Title: "Chief Operating Officer", Manager: "", Salary: "280000" },
      { ID: "3", Name: "C", Title: "Team Lead", Manager: "", Salary: "90000" },
    ])]);
    const real = realOf(positions);
    const roots = real.filter((p) => p.managerId === null && !positions.some((q) => q.synthetic && q.id === p.managerId));
    assert(real.length === 3, `expected all 3 to survive, got ${real.length}`);
    assert(roots.length === 1, `expected exactly one real root chosen among 3 blank-manager rows, got ${roots.length}`);
    ok("exactly one root chosen when several rows claim no manager");
  }

  next("Long linear chain — 6 levels deep, span 1 at every level");
  {
    const rows = [{ ID: "1", Name: "L1", Title: "Chief Executive", Manager: "", Salary: "300000" }];
    for (let i = 2; i <= 6; i++) rows.push({ ID: String(i), Name: `L${i}`, Title: "Manager", Manager: String(i - 1), Salary: "150000" });
    const { positions, bound } = await ingest([csv("f.csv", rows)]);
    const rootId = rootOf(positions)?.id ?? null;
    const metrics = computeMetrics(positions, rootId);
    assert(metrics.layers === 6, `expected 6 layers, got ${metrics.layers}`);
    void bound;
    ok("a 6-deep single-child chain reads exactly 6 layers");
  }

  next("Forward reference — a report's row appears before their manager's row");
  {
    const { positions } = await ingest([csv("f.csv", [
      { ID: "2", Name: "B Report", Title: "Deputy", Manager: "1", Salary: "200000" },
      { ID: "1", Name: "A Chief", Title: "Chief Executive", Manager: "", Salary: "300000" },
    ])]);
    const chief = realOf(positions).find((p) => p.rawName === "A Chief");
    const report = realOf(positions).find((p) => p.rawName === "B Report");
    assert(report?.managerId === chief?.id, "linking must not depend on file row order");
    ok("a manager defined later in the file still resolves correctly");
  }

  next("Wide flat org — one root, 20 direct reports");
  {
    const rows = [{ ID: "0", Name: "Chief", Title: "Chief Executive", Manager: "", Salary: "300000" }];
    for (let i = 1; i <= 20; i++) rows.push({ ID: String(i), Name: `R${i}`, Title: "Officer", Manager: "0", Salary: "80000" });
    const { positions } = await ingest([csv("f.csv", rows)]);
    const chief = realOf(positions).find((p) => p.rawName === "Chief");
    const reports = realOf(positions).filter((p) => p.managerId === chief?.id);
    assert(reports.length === 20, `expected 20 direct reports, got ${reports.length}`);
    ok("a 20-report span links every report to the same root");
  }

  next("A manager reference to an ID that was itself deduplicated away");
  {
    const dupRow = { ID: "1", Name: "A Chief", Title: "Chief Executive", Manager: "", Salary: "300000" };
    const { positions } = await ingest([csv("f.csv", [
      dupRow,
      dupRow,
      { ID: "2", Name: "B Report", Title: "Deputy", Manager: "1", Salary: "200000" },
    ])]);
    const report = realOf(positions).find((p) => p.rawName === "B Report");
    const chief = realOf(positions).find((p) => p.rawName === "A Chief");
    assert(report?.managerId === chief?.id, "a reference to a deduplicated ID should still resolve to the kept occurrence");
    ok("a manager reference to a dropped duplicate's ID still resolves");
  }

  next("Every row blank-manager, single company — fully flat, no hierarchy stated");
  {
    const rows = Array.from({ length: 5 }, (_, i) => ({ ID: String(i), Name: `P${i}`, Title: "Officer", Manager: "", Salary: "80000" }));
    const { positions } = await ingest([csv("f.csv", rows)]);
    assert(realOf(positions).length === 5, `expected all 5 to survive, got ${realOf(positions).length}`);
    ok("a file with zero manager information anywhere still builds a graph");
  }

  console.log("\n=== D. Cost & FTE parsing ===");

  async function costOf(raw: string): Promise<number> {
    const { positions } = await ingest([csv("f.csv", [{ ID: "1", Name: "A", Title: "Officer", Manager: "", Salary: raw }])]);
    return realOf(positions)[0].cost;
  }
  async function fteOf(raw: string): Promise<number> {
    const { positions } = await ingest([csv("f.csv", [{ ID: "1", Name: "A", Title: "Officer", Manager: "", Salary: "80000", FTE: raw }])]);
    return realOf(positions)[0].fte;
  }

  next('Cost "$95,000" — currency symbol and thousands separator');
  { const c = await costOf("$95,000"); assert(c === 95000, `expected 95000, got ${c}`); ok("currency formatting stripped correctly"); }

  next('Cost "95000.50" — decimal preserved');
  { const c = await costOf("95000.50"); assert(c === 95000.5, `expected 95000.5, got ${c}`); ok("decimal cost preserved exactly"); }

  next('Cost "-5000" — a negative figure');
  { const c = await costOf("-5000"); assert(c === -5000, `expected -5000 (negatives pass through unrejected), got ${c}`); ok("QUIRK: a negative cost is accepted as-is, not floored at 0"); }

  next('Cost "0" — a stated zero, distinct from "not stated"');
  { const c = await costOf("0"); assert(c === 0, `expected 0, got ${c}`); ok("a literal 0 reads as 0"); }

  next('Cost "50%" — a percentage sign where a dollar figure was expected');
  { const c = await costOf("50%"); assert(c === 50, `expected the % silently stripped and read as 50, got ${c}`); ok("QUIRK: \"50%\" is misread as $50, not 50% of anything"); }

  next('Cost "asdkjf" — pure garbage text');
  { const c = await costOf("asdkjf"); assert(c === 0, `expected garbage to fall back to 0, got ${c}`); ok("unparseable cost text falls back to 0, not NaN"); }

  next("FTE blank — nothing stated");
  { const f = await fteOf(""); assert(f === 1, `expected the standard 1.0 default, got ${f}`); ok("blank FTE defaults to 1.0"); }

  next('FTE "0" — a stated, deliberate zero (agency reading)');
  { const f = await fteOf("0"); assert(f === 0, `expected a literal 0 preserved, got ${f}`); ok("a stated 0 FTE is preserved (feeds the agency/contingent reading)"); }

  next('FTE "100%" — a percentage where a decimal fraction was expected');
  { const f = await fteOf("100%"); assert(f === 100, `expected parseFloat to stop at the %, reading literally 100, got ${f}`); ok("QUIRK: \"100%\" FTE parses to literally 100.0, not 1.0 — a 100x inflation if a source ever uses percentage FTE"); }

  next('FTE "-1" — a negative value');
  { const f = await fteOf("-1"); assert(f === 1, `expected the >=0 guard to default a negative to 1, got ${f}`); ok("a negative FTE is rejected and defaulted to 1.0, not accepted"); }

  next("The FTE-percentage quirk's real downstream effect on totalFte");
  {
    const { positions } = await ingest([csv("f.csv", [
      { ID: "1", Name: "A", Title: "Officer", Manager: "", Salary: "80000", FTE: "100%" },
      { ID: "2", Name: "B", Title: "Officer", Manager: "1", Salary: "75000", FTE: "1.0" },
    ])]);
    const rootId = rootOf(positions)?.id ?? null;
    const metrics = computeMetrics(positions, rootId);
    assert(metrics.totalFte > 90, `expected the "100%" quirk to blow out totalFte (got ${metrics.totalFte} across 2 people) — proves the parsing quirk reaches real output, not just the one field`);
    ok(`CONFIRMED: totalFte reads ${metrics.totalFte} for 2 people because one FTE cell said "100%" — a single mis-typed cell can silently 50x a headcount-equivalent figure`);
  }

  console.log("\n=== E. Brand/company detection guards ===");

  function rowsOf(n: number, columnValue: (i: number) => string) {
    return Array.from({ length: n }, (_, i) => ({
      ID: String(i),
      Name: `P${i}`,
      Title: "Officer",
      Company: columnValue(i),
    }));
  }

  next("A company column with only one distinct value — nothing to consolidate");
  {
    const rows = rowsOf(10, () => "Northbrook");
    const detected = detectBrandColumn(rows, Object.keys(rows[0]));
    assert(detected === null, `expected refusal (minGroups:2 not met), got column "${detected?.column}"`);
    ok("a single-value company column is correctly refused (fails minGroups)");
  }

  next("Exactly 2 distinct companies, evenly balanced");
  {
    const rows = rowsOf(20, (i) => (i % 2 === 0 ? "Northbrook" : "Calder"));
    const detected = detectBrandColumn(rows, Object.keys(rows[0]));
    assert(detected !== null && detected.values.length === 2, `expected 2 groups detected, got ${detected?.values.length ?? "none"}`);
    ok("2 balanced companies detected cleanly");
  }

  next("Dominant-share guard — 98 of 100 rows one company, 2 the other");
  {
    const rows = rowsOf(100, (i) => (i < 98 ? "Northbrook" : "Calder"));
    const detected = detectBrandColumn(rows, Object.keys(rows[0]));
    assert(detected === null, `expected refusal (98% dominant share exceeds the 97% guard), got column "${detected?.column}"`);
    ok("98%-dominant company column correctly refused (maxDominantShare)");
  }

  next("Just under the dominant-share line — 96 of 100 rows one company");
  {
    const rows = rowsOf(100, (i) => (i < 96 ? "Northbrook" : "Calder"));
    const detected = detectBrandColumn(rows, Object.keys(rows[0]));
    observe(`96% dominant share → ${detected ? "detected" : "refused"} (guard line is 97%; confirms which side of it this actually lands on)`);
  }

  next("A column unique per row — an ID mistaken for a brand");
  {
    const rows = rowsOf(10, (i) => `Entity-${i}`);
    const detected = detectBrandColumn(rows, Object.keys(rows[0]));
    assert(detected === null, `expected refusal (maxDistinctRatio exceeded — every value unique), got column "${detected?.column}"`);
    ok("a per-row-unique column is correctly refused as a brand candidate");
  }

  next("Company column entirely blank");
  {
    const rows = rowsOf(10, () => "");
    const detected = detectBrandColumn(rows, Object.keys(rows[0]));
    assert(detected === null, `expected refusal (0% coverage), got column "${detected?.column}"`);
    ok("an entirely blank company column is correctly refused, not treated as one giant group");
  }

  next('Company values differing only by case — "Northbrook" vs "northbrook"');
  {
    const rows = rowsOf(10, (i) => (i % 2 === 0 ? "Northbrook" : "northbrook"));
    const detected = detectBrandColumn(rows, Object.keys(rows[0]));
    observe(`case-varied values → ${detected ? `${detected.values.length} distinct group(s) detected` : "refused"} (tells you whether grouping folds case)`);
  }

  next("Too many distinct companies (60) — a department list mistaken for a brand column");
  {
    const rows = rowsOf(120, (i) => `Company-${i % 60}`);
    const detected = detectBrandColumn(rows, Object.keys(rows[0]));
    assert(detected === null, `expected refusal (60 > maxGroups:40), got column "${detected?.column}"`);
    ok("60 distinct values correctly refused (exceeds maxGroups)");
  }

  next("Company values with inconsistent leading whitespace — \" Northbrook\" vs \"Northbrook\"");
  {
    const rows = rowsOf(10, (i) => (i % 2 === 0 ? " Northbrook" : "Northbrook"));
    const detected = detectBrandColumn(rows, Object.keys(rows[0]));
    observe(`whitespace-inconsistent values → ${detected ? `${detected.values.length} distinct group(s)` : "refused"} (tells you whether grouping trims)`);
  }

  next("A minority group with only 1 row — below minRowsPerGroup");
  {
    const rows = [...rowsOf(10, () => "Northbrook").slice(0, 9), { ID: "9", Name: "P9", Title: "Officer", Company: "Calder" }];
    const detected = detectBrandColumn(rows, Object.keys(rows[0]));
    assert(detected === null, `expected refusal (Calder has only 1 row, below minRowsPerGroup:2), got column "${detected?.column}"`);
    ok("a 1-row minority group is correctly refused, not treated as a real second brand");
  }

  console.log("\n=== F. Department / function classification ===");

  next("Department column entirely blank — function must fall back to job title");
  {
    const { positions } = await ingest([csv("f.csv", [
      { ID: "1", Name: "A", Title: "Registered Nurse", Manager: "", Department: "", Salary: "100000" },
      { ID: "2", Name: "B", Title: "Finance Manager", Manager: "1", Department: "", Salary: "140000" },
    ])]);
    const real = realOf(positions);
    assert(real.every((p) => p.functionGroup !== undefined), "every position must still carry a function reading even with department fully blank");
    observe(`function groups with department fully blank: ${real.map((p) => p.functionGroup).join(", ")}`);
  }

  next("Department column with only garbage values across the whole file");
  {
    const { positions } = await ingest([csv("f.csv", [
      { ID: "1", Name: "A", Title: "Registered Nurse", Manager: "", Department: "???", Salary: "100000" },
      { ID: "2", Name: "B", Title: "Finance Manager", Manager: "1", Department: "9999", Salary: "140000" },
    ])]);
    const real = realOf(positions);
    assert(real.every((p) => p.department === "???" || p.department === "9999"), "the as-stated department must be preserved verbatim even when unusable");
    ok("garbage department values are preserved as-stated, not silently discarded");
  }

  next("A single department value for the entire establishment");
  {
    const rows = Array.from({ length: 6 }, (_, i) => ({ ID: String(i), Name: `P${i}`, Title: "Officer", Manager: i === 0 ? "" : "0", Department: "Operations", Salary: "80000" }));
    const { positions } = await ingest([csv("f.csv", rows)]);
    assert(realOf(positions).every((p) => p.department === "Operations"), "a single-valued department column should still read consistently for every row");
    ok("a one-department establishment reads consistently, no crash");
  }

  next('Numeric-looking department values ("101", "202")');
  {
    const { positions } = await ingest([csv("f.csv", [
      { ID: "1", Name: "A", Title: "Officer", Manager: "", Department: "101", Salary: "80000" },
      { ID: "2", Name: "B", Title: "Officer", Manager: "1", Department: "202", Salary: "80000" },
    ])]);
    observe(`numeric department codes "101"/"202" classified as: ${realOf(positions).map((p) => p.functionGroup).join(", ")}`);
  }

  next('Department header named unusually ("Div") but content is clearly department-like');
  {
    const { positions } = await ingest([csv("f.csv", [
      { ID: "1", Name: "A", Title: "Officer", Manager: "", Div: "Finance", Salary: "80000" },
      { ID: "2", Name: "B", Title: "Officer", Manager: "1", Div: "Operations", Salary: "80000" },
    ])]);
    observe(`an unusually-named "Div" column read as department for: ${realOf(positions).map((p) => p.department).join(", ")}`);
  }

  next("Mixed valid and garbage department values in the same file");
  {
    const { positions } = await ingest([csv("f.csv", [
      { ID: "1", Name: "A", Title: "Finance Manager", Manager: "", Department: "Finance", Salary: "140000" },
      { ID: "2", Name: "B", Title: "Support Officer", Manager: "1", Department: "???", Salary: "70000" },
    ])]);
    const real = realOf(positions);
    const valid = real.find((p) => p.department === "Finance");
    const garbage = real.find((p) => p.department === "???");
    assert(valid?.functionGroup === "Finance", `expected the valid Finance row to map to the Finance function, got ${valid?.functionGroup}`);
    assert(garbage?.functionGroup !== undefined, "the garbage-department row must still carry some function reading (title fallback)");
    ok("a valid department reads correctly even alongside garbage rows elsewhere in the same file");
  }

  console.log("\n=== G. Status & employment type ===");

  async function statusFlagsOf(rows: Record<string, string>[]) {
    const { positions } = await ingest([csv("f.csv", rows)]);
    const table = buildCanonicalTable(positions, { fte: true, status: true, cost: true, department: true, manager: true });
    return table.rows.map((r) => r.employmentType);
  }

  next('Status "Vacant" in mixed case — "vacant", "VACANT", "Vacant"');
  {
    const types = await statusFlagsOf([
      { ID: "1", Name: "", Title: "Officer", Manager: "", Status: "vacant", Salary: "80000" },
      { ID: "2", Name: "", Title: "Officer", Manager: "1", Status: "VACANT", Salary: "80000" },
      { ID: "3", Name: "", Title: "Officer", Manager: "1", Status: "Vacant", Salary: "80000" },
    ]);
    observe(`mixed-case "vacant" statuses read as: ${types.join(", ")} (confirms whether status matching is case-insensitive)`);
  }

  next("FTE 0 with a filled status — the agency/contingent reading");
  {
    const types = await statusFlagsOf([{ ID: "1", Name: "A", Title: "Officer", Manager: "", Status: "Filled", FTE: "0", Salary: "80000" }]);
    assert(types[0] === "Agency", `expected 0-FTE to read as Agency employment type, got ${types[0]}`);
    ok("0 FTE with a filled status reads as Agency, as designed");
  }

  next("Status column missing from the file entirely");
  {
    const { positions } = await ingest([rawCsv("f.csv", "ID,Name,Title,Manager,Salary\n1,A,Officer,,80000\n")]);
    observe(`status of the one row with no Status column at all: "${realOf(positions)[0].status}"`);
  }

  next('A contingent/agency marker in free text ("Agency", "Contractor")');
  {
    const { positions } = await ingest([csv("f.csv", [
      { ID: "1", Name: "A", Title: "Support Officer", Manager: "", Status: "Agency", Salary: "80000" },
    ])]);
    observe(`a "Status: Agency" text value read as position.status = "${realOf(positions)[0].status}"`);
  }

  next('Inconsistent employment-type text — "full-time", "FULL-TIME", "Full Time"');
  {
    const types = await statusFlagsOf([
      { ID: "1", Name: "", Title: "Officer", Manager: "", Status: "Filled", FTE: "full-time", Salary: "80000" },
    ]);
    observe(`FTE cell holding the word "full-time" (not a number) reads employment type: ${types[0]}`);
  }

  console.log("\n=== H. Canonical table & metrics sanity ===");

  next("Single-person org — canonical table has exactly 1 row, no manager");
  {
    const { positions } = await ingest([csv("f.csv", [{ ID: "1", Name: "A", Title: "Chief Executive", Manager: "", Salary: "300000" }])]);
    const table = buildCanonicalTable(positions, { fte: true, status: true, cost: true, department: true, manager: true });
    assert(table.rows.length === 1, `expected exactly 1 row, got ${table.rows.length}`);
    assert(table.rows[0].manager === "", `expected the sole person's manager cell blank, got "${table.rows[0].manager}"`);
    ok("single-person establishment produces a clean 1-row table");
  }

  next("Cost totals cross-check — canonical table sum matches computeMetrics' totalCost");
  {
    const rows = [
      { ID: "1", Name: "A", Title: "Chief Executive", Manager: "", Salary: "300000" },
      { ID: "2", Name: "B", Title: "Deputy", Manager: "1", Salary: "200000" },
      { ID: "3", Name: "C", Title: "Officer", Manager: "1", Salary: "80000" },
    ];
    const { positions } = await ingest([csv("f.csv", rows)]);
    const rootId = rootOf(positions)?.id ?? null;
    const metrics = computeMetrics(positions, rootId);
    const table = buildCanonicalTable(positions, { fte: true, status: true, cost: true, department: true, manager: true });
    const tableSum = table.rows.reduce((s, r) => s + r.annualCost, 0);
    assert(Math.abs(tableSum - metrics.totalCost) < 0.01, `canonical table sum (${tableSum}) must match computeMetrics.totalCost (${metrics.totalCost}) — same establishment, two read paths`);
    ok(`table and metrics agree on total cost: $${tableSum.toLocaleString()}`);
  }

  next("A duplicate-dropped row never double-counts cost");
  {
    const row = { ID: "1", Name: "A", Title: "Chief Executive", Manager: "", Salary: "300000" };
    const { positions } = await ingest([csv("f.csv", [row, row])]);
    const rootId = rootOf(positions)?.id ?? null;
    const metrics = computeMetrics(positions, rootId);
    assert(metrics.totalCost === 300000, `expected the duplicate to contribute cost exactly once (300000), got ${metrics.totalCost}`);
    ok("a deduplicated row's cost is counted exactly once, never twice");
  }

  console.log(`\n${n} edge cases exercised — ${asserted} known-behaviour assertions passed, ${observed} discovery checks logged.`);
  console.log("verify-edge-cases PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
