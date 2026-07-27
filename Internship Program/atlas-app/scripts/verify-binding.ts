/**
 * Verifies multi-file binding against the shape org data actually arrives in:
 * an establishment split across two files, a payroll extract that is the only
 * source of cost, a status report using different column names, and a file
 * with no usable key at all. Fixtures are derived from the demo CSV at run
 * time so this stays self-contained. Run with
 * `npx tsx --env-file=.env.local scripts/verify-binding.ts`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseEstablishmentFile } from "../lib/ingest/parseFile";
import { bindFiles, type SourceFile } from "../lib/ingest/bindFiles";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { computeMetrics } from "../lib/metrics/diagnostics";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function toCsv(rows: Record<string, string>[]): string {
  const headers = Object.keys(rows[0]);
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => esc(r[h] ?? "")).join(",")),
  ].join("\n");
}

function asSource(filename: string, rows: Record<string, string>[]): SourceFile {
  return {
    filename,
    parsed: parseEstablishmentFile(filename, Buffer.from(toCsv(rows), "utf8")),
  };
}

async function main() {
  const buffer = await readFile(
    path.join(process.cwd(), "db", "seed-data", "meridian-full-establishment.csv")
  );
  const all = parseEstablishmentFile("meridian-full-establishment.csv", buffer).rows;
  console.log(`Source establishment: ${all.length} rows\n`);

  // Two halves of the establishment, from "different systems": different
  // column names, and neither carries cost.
  const clinical = all.filter((r) => r["Department"] === "Clinical Operations");
  const corporate = all.filter((r) => r["Department"] !== "Clinical Operations");
  assert(clinical.length > 0 && corporate.length > 0, "expected both halves to be non-empty");

  const rosterA = asSource(
    "establishment-clinical.csv",
    clinical.map((r) => ({
      "Position ID": r["Position ID"],
      "Employee Name": r["Employee Name"],
      "Position Title": r["Position Title"],
      Department: r["Department"],
      "Manager ID": r["Manager ID"],
    }))
  );

  const rosterB = asSource(
    "establishment-corporate.csv",
    corporate.map((r) => ({
      positionId: r["Position ID"],
      employeeName: r["Employee Name"],
      jobTitle: r["Position Title"],
      division: r["Department"],
      reportsTo: r["Manager ID"],
    }))
  );

  // The only source of cost and FTE anywhere in the upload.
  const payroll = asSource(
    "payroll-extract.csv",
    all.map((r) => ({
      "Staff ID": r["Position ID"],
      Remuneration: r["Fully Loaded Cost"],
      FTE: r["FTE"],
    }))
  );

  // Status under a different header again, plus rows for people who left.
  const statusReport = asSource(
    "employment-status.csv",
    [
      ...all.map((r) => ({
        "Position ID": r["Position ID"],
        "Employment Type": r["Status"],
      })),
      { "Position ID": "P999-GONE", "Employment Type": "filled" },
      { "Position ID": "P998-GONE", "Employment Type": "vacant" },
    ]
  );

  // No id, no name, no title — nothing to bind on.
  const unusable = asSource("site-policies.csv", [
    { Policy: "Rostering", Owner: "Board", Reviewed: "2026-01-01" },
    { Policy: "Overtime", Owner: "Board", Reviewed: "2026-02-01" },
  ]);

  const sources = [rosterA, rosterB, payroll, statusReport, unusable];
  const bound = bindFiles(sources);

  for (const b of bound.bindings) {
    console.log(`── ${b.filename}  [${b.role}]`);
    console.log(`   ${b.detail}`);
  }
  console.log(`\nCombined: ${bound.rows.length} rows, columns: ${bound.headers.join(", ")}\n`);

  // --- the two rosters stacked, nothing lost or duplicated ---------------
  assert(
    bound.rows.length === all.length,
    `expected the two rosters to reassemble ${all.length} rows, got ${bound.rows.length}`
  );
  const rosterBindings = bound.bindings.filter((b) => b.role === "roster");
  assert(rosterBindings.length === 2, `expected 2 rosters, got ${rosterBindings.length}`);

  // --- the payroll join actually supplied the money ----------------------
  const payrollBinding = bound.bindings.find((b) => b.filename === "payroll-extract.csv")!;
  assert(payrollBinding.role === "attributes", "payroll should be joined, not stacked");
  assert(payrollBinding.joinKey === "positionId", `expected an ID join, got ${payrollBinding.joinKey}`);
  assert(
    payrollBinding.contributedFields.includes("cost"),
    `payroll should have supplied cost, contributed: ${payrollBinding.contributedFields}`
  );
  const withCost = bound.rows.filter((r) => (r.cost ?? "").trim() !== "").length;
  assert(
    withCost === bound.rows.length,
    `expected every row to have a cost from payroll, got ${withCost}/${bound.rows.length}`
  );

  // --- unmatched rows are reported, not silently absorbed ----------------
  const statusBinding = bound.bindings.find((b) => b.filename === "employment-status.csv")!;
  assert(
    statusBinding.unmatchedRows === 2,
    `expected the 2 departed staff to be reported unmatched, got ${statusBinding.unmatchedRows}`
  );
  assert(statusBinding.contributedFields.includes("status"), "status report should have supplied status");

  // --- a file with no key is refused, loudly -----------------------------
  const unusableBinding = bound.bindings.find((b) => b.filename === "site-policies.csv")!;
  assert(unusableBinding.role === "unusable", "the policy file should be reported unusable");
  assert(
    unusableBinding.detail.toLowerCase().includes("not used"),
    "an unusable file must say plainly that it was not used"
  );

  // --- and the whole thing still builds a working org --------------------
  const { positions, issues } = await buildOrgGraph(bound, {
    orgId: "verify-binding",
    anonymize: true,
  });
  const rootId = positions.find((p) => p.managerId === null)?.id ?? null;
  assert(rootId !== null, "expected a resolved root across the bound files");
  const metrics = computeMetrics(positions, rootId);

  assert(metrics.totalCost > 0, "cost must have survived the join into the metrics");
  assert(metrics.contingentCount > 0, "status must have survived the join into the metrics");
  assert(metrics.layers > 1, "reporting lines must resolve across the two roster files");

  console.log(
    `Built org: ${metrics.headcount} positions · $${metrics.totalCost.toLocaleString()} · ${metrics.layers} layers · avg span ${metrics.averageSpan.toFixed(1)}`
  );
  console.log(`Ingest issues raised: ${issues.length}`);

  // Reporting lines cross the file boundary: clinical staff report to
  // managers that only exist in the other file.
  const crossFile = positions.filter((p) => {
    const mgr = positions.find((m) => m.id === p.managerId);
    return mgr && mgr.department !== p.department;
  }).length;
  assert(crossFile > 0, "expected reporting lines that span the two source files");
  console.log(`${crossFile} reporting lines resolve across the two source files.`);

  console.log("\nALL BINDING CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
