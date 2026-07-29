import { UNCLASSIFIED, type Position } from "@/lib/graph/types";

/**
 * The one clean table every raw file eventually becomes.
 *
 * Client data arrives as an establishment list, a payroll extract, a chart in
 * a slide deck and a vacancy report, each from a different system, each
 * naming the same field differently, none of them complete. The engine cannot
 * reason about that, and neither can a person. So everything Atlas reads is
 * reduced to this: one row per person, and the six things a redesign actually
 * turns on — who they are, what function they sit in, whose company they are
 * employed by, who they report to, whether they are contracted at all, and
 * what they cost.
 *
 * It is derived from the saved establishment rather than stored beside it,
 * and that is deliberate. A second copy of the same facts is a second copy
 * that can disagree with the first: correct a paid-hours figure and the
 * positions change while the exported table quietly keeps last week's
 * salaries. Deriving it means the table someone downloads on a Friday is the
 * establishment as it stood on Friday, always, with no reconciliation step
 * that somebody has to remember to run.
 *
 * Everything that could not be filled is left empty and flagged. A blank cell
 * is a fact about the source data; a plausible value in its place is a lie
 * that survives every downstream check.
 */

export type EmploymentType = "Full-time" | "Part-time" | "Agency" | "Vacant" | "Not stated";

export interface CanonicalRow {
  /** 1. The person. Falls back to the position title where the file named nobody. */
  employee: string;
  /**
   * 2. The function this person's department rolls up into — Finance,
   * Operations, People. What every comparison is made across.
   */
  department: string;
  /** The department exactly as the source file stated it. Never overwritten. */
  departmentAsStated: string;
  /** 3. The company or brand employing them. */
  brand: string;
  /** 4. Who they report to, by name. */
  manager: string;
  /** 5. Whether they are contracted, and how. */
  employmentType: EmploymentType;
  /** The contracted FTE behind that word. */
  fte: number;
  /** 6. Salary as recorded against them — a full-time rate, not pro-rated. */
  salary: number | null;
  /**
   * Salary × FTE. Carried because it is the figure every cost, saving and
   * comparison downstream is computed from, and a table whose salary column
   * doesn't reconcile to the map's total is a table that starts an argument.
   */
  annualCost: number;
  /** The job title, kept because a name alone doesn't identify a role. */
  title: string;
  /** What was missing or inferred in this row. Empty means the file said it all. */
  flags: string[];
}

export interface CanonicalTable {
  rows: CanonicalRow[];
  /** Which of the six columns the source files actually supplied, and how completely. */
  coverage: { column: string; filled: number; total: number; note: string }[];
  /** Named so the table can say what a word in it means. */
  brandLabel: string;
}

/** Fields the source files were found to carry, so a gap can be told from a blank. */
export interface SuppliedFields {
  fte: boolean;
  status: boolean;
  cost: boolean;
  department: boolean;
  manager: boolean;
}

/**
 * Which company a position belongs to.
 *
 * On a consolidated establishment Atlas has already inserted a heading per
 * brand to hold the map together, so the brand is the nearest heading above a
 * position — not the top one, which is the group itself and would put every
 * row in the same company.
 */
function brandOf(position: Position, byId: Map<string, Position>): string {
  const seen = new Set<string>();
  let current: Position | undefined = position;

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const parent: Position | undefined = current.managerId
      ? byId.get(current.managerId)
      : undefined;
    // A heading whose own parent is another heading is a brand; a heading
    // with no parent is the group node above all of them.
    if (current.synthetic && current.managerId !== null) return current.title;
    if (!parent) return "";
    current = parent;
  }

  return "";
}

/**
 * What kind of employment the row describes, read off the two fields that
 * decide it and never assumed from either alone.
 *
 * Zero FTE is agency: the person is on the chart and doing the work, but the
 * organisation holds no contracted establishment for them. That reading is
 * registered as an assumption at ingest, which is why it can be relied on
 * here.
 */
function employmentOf(
  position: Position,
  supplied: SuppliedFields
): { type: EmploymentType; flags: string[] } {
  const flags: string[] = [];

  if (position.status === "vacant") return { type: "Vacant", flags };
  if (position.fte === 0) return { type: "Agency", flags };

  if (!supplied.fte) {
    // Nothing in any file said how much of a week this is. The graph holds
    // 1.0 because a position has to have some establishment to be counted at
    // all, but that is Atlas's floor and not the client's figure.
    flags.push("No FTE column reached this row — 1.0 assumed so it could be counted");
    return { type: "Not stated", flags };
  }

  return { type: position.fte >= 1 ? "Full-time" : "Part-time", flags };
}

export function buildCanonicalTable(
  positions: Position[],
  supplied: SuppliedFields,
  brandLabel = "Brand"
): CanonicalTable {
  const byId = new Map(positions.map((p) => [p.id, p]));

  // How many positions hang off each node, and which nodes manage anyone.
  // Needed to tell the two reasons for an empty manager cell apart: being at
  // the top of a brand, and having had no manager stated anywhere in the
  // files so the graph builder attached the row to the brand heading. Both
  // report to a heading; only one of them is a fact about the organisation.
  const childCount = new Map<string, number>();
  for (const p of positions) {
    if (p.managerId) childCount.set(p.managerId, (childCount.get(p.managerId) ?? 0) + 1);
  }
  // Headings are structure, not jobs. A row for one would put a person in the
  // table who does not exist and cannot be paid.
  const real = positions.filter((p) => !p.synthetic);

  const rows: CanonicalRow[] = real.map((p) => {
    const manager = p.managerId ? byId.get(p.managerId) : undefined;
    const { type, flags } = employmentOf(p, supplied);

    if (!p.rawName && p.displayName === p.title) {
      flags.push("No name in any file — identified by job title");
    }
    if (p.department === UNCLASSIFIED) {
      flags.push(
        supplied.department
          ? "No department recorded against this row"
          : "No department column reached this establishment"
      );
    }
    if (p.cost <= 0) {
      flags.push(
        supplied.cost ? "No salary recorded against this row" : "No salary column reached this establishment"
      );
    }
    if (!manager) {
      flags.push("Top of the structure — reports to nobody in the data");
    } else if (manager.synthetic) {
      // A heading with one child below it is that person's brand and they run
      // it. A heading with four hundred is a holding pen for rows nobody
      // stated a manager for, and calling each of them the top of the brand
      // would be four hundred lies in a column that has to be trusted.
      const siblings = childCount.get(manager.id) ?? 0;
      const managesAnyone = (childCount.get(p.id) ?? 0) > 0;
      flags.push(
        siblings === 1 || managesAnyone
          ? `Top of ${manager.title} — reports to nobody inside it`
          : supplied.manager
            ? `No manager stated for this row — placed under the ${manager.title} heading`
            : `No reporting line reached this establishment — placed under the ${manager.title} heading`
      );
    }

    return {
      employee: p.displayName,
      department: p.functionGroup === UNCLASSIFIED ? "" : p.functionGroup,
      departmentAsStated: p.department === UNCLASSIFIED ? "" : p.department,
      brand: brandOf(p, byId),
      // A heading is not a person, so reporting into one is reported as
      // reporting to nobody rather than to a box.
      manager: manager && !manager.synthetic ? manager.displayName : "",
      employmentType: type,
      fte: p.fte,
      salary: p.cost > 0 ? p.cost : null,
      annualCost: p.cost * p.fte,
      title: p.title,
      flags,
    };
  });

  const filled = (predicate: (r: CanonicalRow) => boolean) => rows.filter(predicate).length;

  return {
    rows,
    brandLabel,
    coverage: [
      {
        column: "Employee",
        filled: filled((r) => r.employee.trim() !== "" && r.employee !== r.title),
        total: rows.length,
        note: "Rows named by job title alone carry no person from any file.",
      },
      {
        column: "Function",
        filled: filled((r) => r.department !== ""),
        total: rows.length,
        note: "Without it, functions cannot be compared against each other.",
      },
      {
        column: brandLabel,
        filled: filled((r) => r.brand !== ""),
        total: rows.length,
        note: "Empty where the establishment was not consolidated across entities.",
      },
      {
        column: "Manager",
        filled: filled((r) => r.manager !== ""),
        total: rows.length,
        note: "Empty at the top of the structure and at the top of each brand, by definition.",
      },
      {
        column: "Employment type",
        filled: filled((r) => r.employmentType !== "Not stated"),
        total: rows.length,
        note: "Read from FTE and status together. Zero FTE is agency.",
      },
      {
        column: "Salary",
        filled: filled((r) => r.salary !== null),
        total: rows.length,
        note: "Every cost and saving downstream is of these rows only.",
      },
    ],
  };
}

const CSV_COLUMNS = [
  "Employee",
  "Job title",
  "Function",
  "Department (as stated)",
  "Brand",
  "Manager",
  "Employment type",
  "FTE",
  "Salary",
  "Annual cost (salary x FTE)",
  "Notes",
] as const;

/** Escapes a value for CSV, defensively enough for a file opened in Excel. */
function cell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  // A leading =, +, - or @ makes Excel treat the cell as a formula. Client
  // data holds job titles like "-Vacant-", and a spreadsheet that opens with
  // a formula error is a spreadsheet nobody trusts.
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(table: CanonicalTable): string {
  const header = CSV_COLUMNS.map((c) =>
    c === "Brand" ? cell(table.brandLabel) : cell(c)
  ).join(",");

  const lines = table.rows.map((r) =>
    [
      cell(r.employee),
      cell(r.title),
      cell(r.department),
      cell(r.departmentAsStated),
      cell(r.brand),
      cell(r.manager),
      cell(r.employmentType),
      cell(r.fte),
      cell(r.salary),
      cell(Math.round(r.annualCost)),
      cell(r.flags.join("; ")),
    ].join(",")
  );

  return [header, ...lines].join("\n");
}
