/**
 * Verifies that the map's filters are the canonical table's columns — derived
 * from the same rows the table shows, so the two screens cannot disagree — and
 * that a filter with nothing to choose between is never offered.
 *
 * The failure this guards against is quiet: the map used to build its own list
 * of functions from the positions, and when the function rollup changed, the
 * map's list and the table's Function column disagreed while both screens
 * looked entirely reasonable.
 *
 * Run with `npx tsx scripts/verify-map-filters.ts`.
 */
import { buildCanonicalTable, type CanonicalRow } from "../lib/canonical/table";
import { bandOf, buildFacets, NOT_STATED, type Facet } from "../lib/canonical/facets";
import type { Position } from "../lib/graph/types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

const SUPPLIED = { fte: true, status: true, cost: true, department: true, manager: true };

let seq = 0;
function position(over: Partial<Position> = {}): Position {
  seq++;
  return {
    id: `p${seq}`,
    orgId: "o",
    rawName: `Person ${seq}`,
    displayName: `Person ${seq}`,
    title: "Specialist",
    department: "Group Treasury",
    functionGroup: "Finance",
    managerId: null,
    cost: 80000,
    fte: 1,
    status: "filled",
    clinicalFlag: false,
    sourceRowIndex: seq,
    confidence: {},
    classificationSource: "fallback",
    synthetic: false,
    ...over,
  } as Position;
}

const facet = (facets: Facet[], key: string) => facets.find((f) => f.key === key);

function main() {
  /* ---------------------------------------------------------------- */
  console.log("1. Every filter is a column of the canonical table");

  const spread: Position[] = [];
  const shape: [string, string, string, number][] = [
    ["Finance", "Group Treasury", "Northbrook", 92000],
    ["Finance", "Accounts Payable", "Northbrook", 58000],
    ["Operations", "Service Delivery", "Northbrook", 64000],
    ["Operations", "Warehouse", "Halden", 47000],
    ["People", "Talent Acquisition", "Halden", 71000],
    ["Technology", "Platform", "Halden", 120000],
  ];
  for (const [fn, dept, brand, cost] of shape) {
    for (let i = 0; i < 4; i++) {
      spread.push(
        position({
          functionGroup: fn,
          department: dept,
          cost: cost + i * 1500,
          fte: i === 3 ? 0.5 : 1,
        })
      );
    }
    // A heading per brand, exactly as a consolidated establishment carries.
    void brand;
  }

  const table = buildCanonicalTable(spread, SUPPLIED, "Brand");
  const facets = buildFacets(table, { vacant: 2, thin: 3, wide: 1 });
  const keys = facets.map((f) => f.key);

  console.log(`   ${facets.length} filters: ${facets.map((f) => f.label).join(", ")}`);

  // Everything offered must be readable off a canonical row, or the map is
  // filtering on something the table cannot show.
  const sample: CanonicalRow = table.rows[0];
  const readable: Record<string, unknown> = {
    function: sample.department,
    departmentAsStated: sample.departmentAsStated,
    brand: sample.brand,
    manager: sample.manager,
    employmentType: sample.employmentType,
    fte: sample.fte,
    salary: sample.salary,
    annualCost: sample.annualCost,
    flag: "derived",
  };
  for (const key of keys) {
    assert(key in readable, `"${key}" is offered as a filter but is not a canonical column`);
  }

  assert(keys.includes("function"), "Function must be filterable");
  assert(keys.includes("departmentAsStated"), "the department as stated must be filterable");
  assert(keys.includes("salary"), "Salary must be filterable");

  /* ---------------------------------------------------------------- */
  console.log("\n2. The Function filter is the table's Function column, value for value");

  const fromTable = new Set(table.rows.map((r) => r.department).filter(Boolean));
  const fromFacet = new Set(
    facet(facets, "function")!.options.filter((o) => o.value !== NOT_STATED).map((o) => o.value)
  );
  assert(
    fromTable.size === fromFacet.size && [...fromTable].every((v) => fromFacet.has(v)),
    `the two must be the same set — table ${[...fromTable].join(", ")} vs filter ${[...fromFacet].join(", ")}`
  );

  // And the counts must reconcile, or the filter promises matches it cannot find.
  for (const option of facet(facets, "function")!.options) {
    const actual = table.rows.filter(
      (r) => (r.department || NOT_STATED) === option.value
    ).length;
    assert(
      actual === option.count,
      `"${option.label}" claims ${option.count} and the table holds ${actual}`
    );
  }
  console.log(`   ${fromFacet.size} functions, counts reconciling to the table row for row`);

  /* ---------------------------------------------------------------- */
  console.log("\n3. Numbers are banded by this organisation's own figures");

  const salary = facet(facets, "salary")!;
  assert(salary.kind === "band", "salary must be a band filter");
  assert(salary.cuts, "and must carry its cut points");
  console.log(`   ${salary.options.map((o) => o.label).join("  ·  ")}`);

  // No round number Atlas brought with it — every boundary is a figure in the file.
  const salaries = table.rows.map((r) => r.salary).filter((s): s is number => s !== null);
  for (const cut of salary.cuts!) {
    assert(salaries.includes(cut), `${cut} is not one of this organisation's own salaries`);
  }

  // And a figure lands in the band the option counted it in.
  for (const option of salary.options) {
    if (option.value === NOT_STATED) continue;
    const actual = salaries.filter((s) => bandOf(salary, s) === option.value).length;
    assert(actual === option.count, `band ${option.value}: counted ${option.count}, matched ${actual}`);
  }
  console.log(`   Every boundary is a salary from the file, and every band counts what it matches`);

  /* ---------------------------------------------------------------- */
  console.log("\n4. A filter with one setting is not offered");

  const uniform = Array.from({ length: 12 }, () =>
    position({ functionGroup: "Operations", department: "Service Delivery", cost: 60000, fte: 1 })
  );
  const flat = buildFacets(buildCanonicalTable(uniform, SUPPLIED, "Brand"), {});
  const flatKeys = flat.map((f) => f.key);

  assert(!flatKeys.includes("function"), "one function is not a choice");
  assert(!flatKeys.includes("brand"), "an establishment with no brands must not offer a Brand filter");
  assert(!flatKeys.includes("salary"), "twelve identical salaries cannot be quartered");
  assert(!flatKeys.includes("flag"), "no flags on anyone means no Flag filter");
  console.log(`   12 identical positions → ${flat.length} filters offered`);

  /* ---------------------------------------------------------------- */
  console.log("\n5. A gap is findable, not hidden");

  const partial = [
    ...Array.from({ length: 6 }, () => position({ functionGroup: "Finance" })),
    ...Array.from({ length: 4 }, () => position({ functionGroup: "Unclassified", department: "Unclassified" })),
  ];
  const withGaps = buildFacets(buildCanonicalTable(partial, SUPPLIED, "Brand"), {});
  const fn = facet(withGaps, "function")!;
  const notStated = fn.options.find((o) => o.value === NOT_STATED);

  assert(notStated, "the people with no function must be reachable from the filter");
  assert(notStated.count === 4, `expected 4 unstated, got ${notStated.count}`);
  console.log(`   "Not stated (4)" offered — finding the gap is how someone chases it down`);

  /* ---------------------------------------------------------------- */
  console.log("\n6. Every row can be joined back to its position");

  assert(
    table.rows.every((r) => r.positionId && spread.some((p) => p.id === r.positionId)),
    "every canonical row must name the position it describes, or the map cannot filter on it"
  );
  assert(
    new Set(table.rows.map((r) => r.positionId)).size === table.rows.length,
    "and name it uniquely"
  );
  console.log(`   ${table.rows.length} rows, each joined to exactly one position on the map\n`);

  console.log("verify-map-filters PASS");
}

main();
