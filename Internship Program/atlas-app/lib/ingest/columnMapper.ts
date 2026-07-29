import type { ColumnMapping } from "@/lib/graph/types";

/**
 * Synonym lists for the columns that show up across the common HR export
 * shapes (Workday, SAP SuccessFactors, BambooHR, a bare CSV export). Anything
 * that doesn't match a synonym is still surfaced to the human as an
 * unmapped column rather than silently dropped.
 */
const SYNONYMS = {
  name: ["name", "employee name", "full name", "worker", "employee", "person", "incumbent", "staff name", "employee full name"],
  title: ["title", "position title", "job title", "role", "position", "job", "designation"],
  // Every word an organisation might use for "the part of us this person
  // belongs to". Deliberately wide, because the alternative is a logistics
  // company whose "Depot" column is dropped as unrecognised and a comparison
  // screen that can't compare anything. No list will ever be complete — a
  // column nobody here anticipated is what the upload context box is for,
  // and an unmapped column is reported rather than silently discarded — but
  // the common cases should not need a hint.
  department: [
    "department",
    "dept",
    "division",
    "function",
    "business unit",
    "unit",
    "cost centre",
    "cost center",
    "team",
    "directorate",
    "service",
    "service line",
    "practice",
    "discipline",
    "faculty",
    "branch",
    "depot",
    "site",
    "location",
    "region",
    "portfolio",
    "workstream",
    "group",
    "section",
  ],
  managerName: [
    "manager",
    "manager full name",
    "reporting line",
    "reports to name",
    "direct manager",
    "manager name",
    "reports to",
    "supervisor",
    "manager id",
    "reporting manager",
    "line manager",
    "parent",
    "reports to id",
    "supervisor id",
  ],
  positionId: [
    "position id",
    "id",
    "employee id",
    "employee number",
    "employee no",
    "emp id",
    "emp no",
    "staff number",
    "payroll id",
    "payroll number",
    "position number",
    "role id",
    "staff id",
    "person id",
    "worker id",
  ],
  // What an organisation calls what it pays someone. A payroll export that
  // says "Base Pay" and loses it is worse than one that never had the column:
  // the establishment looks complete and every saving on it is understated
  // by the whole population it couldn't price.
  cost: [
    "cost",
    "salary",
    "base salary",
    "base pay",
    "basic pay",
    "annual salary",
    "gross salary",
    "gross pay",
    "pay",
    "wage",
    "wages",
    "fully loaded cost",
    "annual cost",
    "total cost",
    "employment cost",
    "compensation",
    "total compensation",
    "ctc",
    "flc",
    "remuneration",
    "package",
    // Deliberately NOT "rate". A rate column is as often hourly as annual,
    // and reading an hourly rate as a salary prices a care worker's year at
    // $36. composeColumns.ts reads the basis first and composes an annual
    // cost only when it can prove one; mapping "rate" straight to cost here
    // would beat that and quietly reintroduce the bug it exists to prevent.
  ],
  fte: ["fte", "full time equivalent", "contracted fte", "fte value", "contracted hours"],
  status: ["status", "position status", "employment status", "employment type"],
} satisfies Record<string, string[]>;

/**
 * Headers arrive in whatever shape the source used. A CSV gives
 * "Manager ID"; the same field out of a JSON API is "reportsTo", and out of
 * a nested payload it's "manager.id" — all three have to land on the same
 * canonical field, so casing, separators and dotted paths are flattened to
 * one spaced lower-case form before matching.
 */
function normalize(header: string): string {
  return header
    .trim()
    // Split camelCase / PascalCase into words: reportsTo -> reports To.
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a column's own values rule it out of being a department.
 *
 * A header is not enough to identify a department column. "RateUnit" contains
 * the word "unit", which is a perfectly good word for the part of an
 * organisation someone belongs to — and on a real client file that put 756
 * people in a department called "Hourly" and 104 in one called "Annually",
 * after which the function comparison was between two payroll arrangements
 * and every screen built on it was answering nothing.
 *
 * The values settle it, and settle it without a taxonomy of department names
 * that could never be complete: no organisation has a department called
 * Hourly, Casual or Full-time. Where every distinct value in a column is one
 * of those, the column states how someone is paid or engaged and the header
 * resembling "unit" is a coincidence. Anything less than unanimous is left
 * alone — a genuine "Casual Pool" department must not be thrown away because
 * one of its values reads like a contract type.
 */
const PAY_BASIS =
  /^(hourly|hour|per hour|hr|annual|annually|annum|per annum|p\.? ?a\.?|yearly|year|salaried|salary|weekly|week|fortnightly|fortnight|biweekly|monthly|month|daily|day|sessional|piece rate)$/;

const ENGAGEMENT =
  /^(full[ -]?time|part[ -]?time|ft|pt|casual|permanent|perm|temporary|temp|contract|contractor|fixed[ -]?term|employee|agency|locum|intern|apprentice|volunteer|active|inactive|terminated|vacant|open|filled)$/;

function statesSomethingElse(values: string[]): boolean {
  const distinct = [...new Set(values.map((v) => (v ?? "").trim().toLowerCase()).filter(Boolean))];
  if (distinct.length === 0) return false;
  return distinct.every((v) => PAY_BASIS.test(v) || ENGAGEMENT.test(v));
}

/**
 * @param rows Optional. When the rows are to hand, a column whose values
 * disqualify it from a field is passed over so the field can go to the next
 * best column, or to none — which is honest, and which the confirm screen
 * reports, rather than being quietly filled with the wrong column.
 */
export function mapColumns(
  headers: string[],
  rows?: Record<string, string>[]
): ColumnMapping[] {
  const candidates = headers.map((sourceColumn) => ({
    sourceColumn,
    ...bestMatch(normalize(sourceColumn)),
  }));

  // Only the department field is checked this way. It is the one field whose
  // synonyms are ordinary English words ("unit", "group", "team", "section")
  // that turn up inside the names of columns about something else entirely.
  const disqualified = new Set<string>();
  if (rows && rows.length > 0) {
    for (const c of candidates) {
      if (c.field !== "department") continue;
      if (statesSomethingElse(rows.map((r) => r[c.sourceColumn]))) {
        disqualified.add(c.sourceColumn);
      }
    }
  }

  // Each field goes to the column that resembles it most, not to whichever
  // column happened to be listed first. A file with "FirstName", "Surname"
  // and a composed "Employee Name" has three columns wanting the name field;
  // by position the weakest of the three wins and everyone in the
  // establishment is called "Melanie".
  const winner = new Map<string, string>();
  for (const c of candidates) {
    if (c.field === null || disqualified.has(c.sourceColumn)) continue;
    const held = candidates.find((o) => o.sourceColumn === winner.get(c.field!));
    // Ties go to the earlier column, so a file with one obvious match per
    // field maps exactly as it always did.
    if (!held || c.score > held.score) winner.set(c.field, c.sourceColumn);
  }

  return candidates.map(({ sourceColumn, field, score }) => {
    // A column maps to the field it most resembles, or to nothing. It is
    // never handed to its *second* choice because the first was taken: an
    // establishment with both "Department" and "Cost Centre" would otherwise
    // see the latter lose department, fall through to the "cost" synonym,
    // and quietly become everyone's salary — after which the real payroll
    // figures arrive, disagree, and are discarded as conflicts. An unmapped
    // extra column is recoverable; a poisoned cost field is not.
    const claimed =
      field !== null && !disqualified.has(sourceColumn) && winner.get(field) === sourceColumn;

    return {
      sourceColumn,
      targetField: claimed ? field : null,
      confidence: claimed ? Math.max(score, 0.6) : 0,
      autoMapped: claimed && score >= 0.95,
    };
  });
}

/** The single best field for a header, ignoring what has already been taken. */
function bestMatch(normalized: string): { field: keyof typeof SYNONYMS | null; score: number } {
  let field: keyof typeof SYNONYMS | null = null;
  let score = 0;

  for (const [candidate, synonyms] of Object.entries(SYNONYMS)) {
    for (const syn of synonyms) {
      if (normalized === syn) return { field: candidate as keyof typeof SYNONYMS, score: 1 };

      if (normalized.includes(syn) && syn.length > 2) {
        const candidateScore = syn.length / normalized.length;
        if (candidateScore > score) {
          score = candidateScore;
          field = candidate as keyof typeof SYNONYMS;
        }
      }
    }
  }

  return { field, score };
}
