import { NO_DEPARTMENT } from "./answers";
import { groupByRule } from "./functionGroups";
import { note, type IngestNote, type NoteOption } from "./notes";

/**
 * Finding which part of the organisation each person works in, whatever the
 * column is called and whether or not it is called anything useful.
 *
 * Every establishment file carries this somewhere, and almost none of them
 * agree on the word. "Department" and "Division" are the easy cases. Real
 * files also send "Directorate", "Business Unit", "Service Line", "Cost
 * Centre", "Faculty", "Workstream", "Depot", "Org Unit", "Pillar", "Chapter"
 * — and sometimes a column called "Grp3" holding Finance, Operations and HR,
 * which no synonym list will ever reach.
 *
 * So the column is found three ways, in order of how much they can be
 * trusted:
 *
 *   1. By name. A weighted list, because a file carrying both "Department"
 *      and "Location" must not consolidate on the second.
 *   2. By shape. A department column repeats itself, covers most of the
 *      establishment, and is not an identifier, a date or a number. This is
 *      what stops a column of employee IDs winning on a lucky header.
 *   3. By content. A department column holds department names — Finance,
 *      Clinical, Engineering, Warehouse — and those are recognisable in
 *      themselves. This is the only test that can find a column whose header
 *      says nothing, and it is the one that catches a well-named column
 *      holding something else entirely.
 *
 * The three are combined rather than tried in turn: a good name with
 * unrecognisable contents still wins over no name at all, but a column whose
 * contents are plainly departments beats a column that merely sounds like it
 * should be. What none of them will do is invent a department for a file that
 * does not carry one — an establishment with a blank department column is a
 * fact about the client's data, and filling it with the nearest column that
 * happened to be text is how "Hourly" became a department.
 */

/**
 * What organisations call the part of themselves someone works in.
 *
 * Weighted by how unambiguous each term is. The bottom of the list is places
 * rather than functions — a depot or a region is where someone works rather
 * than what they do — so they are used only when nothing better exists, which
 * for a logistics operator is exactly right and for a bank is exactly wrong.
 */
const DEPARTMENT_TERMS: { term: string; weight: number }[] = [
  { term: "department", weight: 10 },
  { term: "dept", weight: 10 },
  { term: "division", weight: 10 },
  { term: "directorate", weight: 9 },
  { term: "business unit", weight: 9 },
  { term: "org unit", weight: 9 },
  { term: "organisational unit", weight: 9 },
  { term: "organizational unit", weight: 9 },
  { term: "sub department", weight: 9 },
  { term: "subdivision", weight: 9 },
  { term: "function", weight: 9 },
  { term: "functional area", weight: 9 },
  { term: "job family", weight: 8 },
  { term: "faculty", weight: 8 },
  { term: "service line", weight: 8 },
  { term: "service area", weight: 8 },
  { term: "workstream", weight: 8 },
  { term: "work stream", weight: 8 },
  { term: "cost centre", weight: 7 },
  { term: "cost center", weight: 7 },
  { term: "team", weight: 7 },
  { term: "section", weight: 7 },
  { term: "branch", weight: 7 },
  { term: "practice", weight: 7 },
  { term: "discipline", weight: 7 },
  { term: "portfolio", weight: 7 },
  { term: "business area", weight: 6 },
  { term: "capability", weight: 6 },
  { term: "chapter", weight: 6 },
  { term: "pillar", weight: 6 },
  { term: "service", weight: 5 },
  { term: "unit", weight: 5 },
  { term: "group", weight: 5 },
  { term: "area", weight: 5 },
  { term: "stream", weight: 5 },
  { term: "segment", weight: 4 },
  // Deliberately NOT "category". In HR exports it nearly always classifies
  // the employee rather than the organisation — Direct/Indirect, blue collar
  // /white collar, pay band — and on the first real client file it held
  // "Direct, Indirect, Semi-Direct", which is a costing distinction and not a
  // part of the business. A client whose category column really is their
  // department can say so in the instructions box.
  { term: "depot", weight: 4 },
  { term: "site", weight: 4 },
  { term: "location", weight: 3 },
  { term: "region", weight: 3 },
];

/** Guards, each closing off one specific way of being wrong. */
const RULES = {
  /** One value is not a department structure. */
  minGroups: 2,
  /** Beyond this the column is a note field or an identifier. */
  maxGroups: 300,
  /** Below this the column describes a fraction of the establishment. */
  minCoverage: 0.5,
  /** A department column repeats; an identifier does not. */
  maxDistinctRatio: 0.5,
  /** One value covering nearly everything means the others are noise. */
  maxDominantShare: 0.98,
  /**
   * The share of distinct values that must read as a department for a column
   * with no recognisable header to be believed on its contents alone.
   */
  minPlacementUnnamed: 0.6,
  /**
   * And at least this many of them. Two is not enough: a group whose trading
   * names all end in the same industry word has a brand column where half the
   * values read as department names on that word alone, and it very nearly
   * became the department structure of a real establishment.
   */
  minPlacedUnnamed: 3,
};

/**
 * The column the spreadsheet reader adds when it stacks one worksheet per
 * tab. It records which sheet a row came from, which is a fact about the
 * workbook rather than about the organisation — and a workbook is as often
 * split by trading name or by month as by department. Where it genuinely is
 * the department, the client can say so in the instructions box.
 */
const SHEET_COLUMN = "Source sheet";

/**
 * Values that state how someone is paid or engaged. A column of these is
 * never a department, whatever it is called — this is the check that stops a
 * "RateUnit" column of Hourly and Annually becoming two departments.
 */
const NOT_A_DEPARTMENT =
  /^(hourly|hour|per hour|hr|annual|annually|annum|per annum|p\.? ?a\.?|yearly|year|salaried|salary|weekly|week|fortnightly|fortnight|biweekly|monthly|month|daily|day|sessional|full[ -]?time|part[ -]?time|ft|pt|casual|permanent|perm|temporary|temp|contract|contractor|fixed[ -]?term|employee|agency|locum|intern|apprentice|volunteer|active|inactive|terminated|vacant|open|filled|yes|no|y|n|true|false|male|female|m|f|other)$/;

/** A value that is a number, a date, a percentage or a currency amount. */
const NOT_TEXT = /^[\s$£€¥]*[-+]?[\d.,/\\:%()]+\s*$/;

function normalise(header: string): string {
  return header
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** How strongly a header says "this is the part of the organisation". */
function nameScore(header: string): number {
  const h = normalise(header);
  let best = 0;

  for (const { term, weight } of DEPARTMENT_TERMS) {
    // Exact beats contained, so "Department" outranks "Department Head" and
    // "Rate Unit" never outranks either.
    const hit =
      h === term ? weight + 5 : h.includes(term) ? weight * (term.length / h.length) : 0;
    if (hit > best) best = hit;
  }

  return best;
}

export interface DepartmentDetection {
  column: string;
  /** The distinct values, most common first. */
  values: string[];
  coverage: number;
  /** Share of distinct values that read as a department in themselves. */
  placementRate: number;
  /** Whether the header said so, the contents said so, or both. */
  found: "name" | "contents" | "both";
  /** Columns that also looked like a department and were not used. */
  runnersUp: string[];
}

interface Shape {
  values: string[];
  coverage: number;
  placementRate: number;
}

/**
 * Above this, the header is taken at its word.
 *
 * A column called "Department" is the department. The shape rules below exist
 * to stop an ID column or a note field winning on a weak resemblance — they
 * are not there to argue with a client who labelled their own data plainly,
 * and applied to one they reject a twelve-person establishment with eight
 * departments in it for looking too much like a list of identifiers.
 */
const TRUST_NAME = 9;

/**
 * What a column's own values say about whether it could be a department.
 *
 * @param strict Whether to apply the rules that tell a department column from
 * an identifier. Skipped for a column whose header already says what it is,
 * because there the contents can only disprove it, not have to prove it.
 */
function shapeOf(
  rows: Record<string, string>[],
  column: string,
  strict: boolean
): Shape | null {
  const counts = new Map<string, number>();
  let filled = 0;

  for (const row of rows) {
    const value = (row[column] ?? "").trim();
    if (!value) continue;
    filled++;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  if (filled === 0) return null;

  const coverage = filled / rows.length;
  if (coverage < RULES.minCoverage) return null;

  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  if (strict) {
    // One value is not evidence of a department structure — but it is a
    // perfectly good department column when the header says so. Half an
    // establishment exported out of the clinical system carries "Clinical
    // Operations" on every row, and rejecting it loses the department for
    // everyone in that file.
    if (counts.size < RULES.minGroups) return null;
    if (counts.size > RULES.maxGroups) return null;
    // Every value unique is an identifier, at any size.
    if (counts.size === filled) return null;
    if (counts.size / filled > RULES.maxDistinctRatio) return null;
    if (ordered[0][1] / filled > RULES.maxDominantShare) return null;
  }

  const distinct = ordered.map(([v]) => v);

  // A column of numbers, dates or amounts is not a department however it is
  // headed — "Cost Centre" holding 4021, 4022, 4023 is a code the client can
  // read and Atlas cannot, and putting it on screen as a department name
  // would be worse than leaving it out.
  if (distinct.filter((v) => NOT_TEXT.test(v)).length / distinct.length > 0.5) return null;

  // And a column stating how someone is paid or engaged is never one.
  if (distinct.every((v) => NOT_A_DEPARTMENT.test(v.toLowerCase()))) return null;

  const placed = distinct.filter((v) => groupByRule(v) !== null).length;

  return { values: distinct, coverage, placementRate: placed / distinct.length };
}

/**
 * Picks the column holding the department, or nothing.
 *
 * Called only when the synonym matcher found no department — an explicit
 * instruction and a plain header both win, because they are what the client
 * actually said.
 *
 * @param exclude Columns already carrying another field. A "Job Title" column
 * places into function groups beautifully and is not a department.
 */
export function detectDepartmentColumn(
  rows: Record<string, string>[],
  headers: string[],
  exclude: Set<string> = new Set()
): DepartmentDetection | null {
  if (rows.length === 0) return null;

  const viable: (DepartmentDetection & { score: number })[] = [];

  for (const column of headers) {
    if (exclude.has(column) || column === SHEET_COLUMN) continue;

    const name = nameScore(column);
    const shape = shapeOf(rows, column, name < TRUST_NAME);
    if (!shape) continue;

    // A header that means nothing has to be carried entirely by its contents,
    // and the bar for that is high: most of the values have to read as
    // departments in their own right, and enough of them to rule out two
    // coincidences in a column of something else.
    const placed = Math.round(shape.placementRate * shape.values.length);
    const byContents =
      shape.placementRate >= RULES.minPlacementUnnamed && placed >= RULES.minPlacedUnnamed;

    if (name === 0 && !byContents) continue;

    viable.push({
      // Contents are worth as much as a strong header, so a column called
      // "Grp3" full of Finance and Operations beats a column called "Region"
      // full of postcodes.
      score: name + shape.placementRate * 10,
      column,
      values: shape.values,
      coverage: shape.coverage,
      placementRate: shape.placementRate,
      // What to tell the client. A column can qualify on its header alone and
      // still have contents that plainly agree, and saying so is worth more
      // on the register than repeating the header back at them.
      found:
        name === 0
          ? "contents"
          : shape.placementRate >= RULES.minPlacementUnnamed
            ? "both"
            : "name",
      runnersUp: [],
    });
  }

  if (viable.length === 0) return null;

  viable.sort((a, b) => b.score - a.score);
  const [chosen, ...rest] = viable;
  return { ...chosen, runnersUp: rest.map((r) => r.column) };
}

/**
 * The reading, registered so it can be overruled.
 *
 * Every function comparison on the findings screen is built on this column,
 * so a client who disagrees with the choice disagrees with all of it — and
 * they can only do that if they are told which column was taken and which
 * ones were not.
 */
export function departmentNote(detection: DepartmentDetection): IngestNote {
  const { column, values, coverage, placementRate, found, runnersUp } = detection;
  const shown = values.slice(0, 8);

  return note("department-detected", "assumption", {
    topic: "Department column found in your data",
    statement:
      `No column was named as the department, so Atlas took "${column}" — ` +
      (found === "contents"
        ? `not because of what it is called, but because its values are department names.`
        : found === "both"
          ? `its name says so and its values are department names.`
          : `its name says so.`),
    evidence:
      `${values.length} distinct value${values.length === 1 ? "" : "s"} across ` +
      `${(coverage * 100).toFixed(0)}% of rows — ${shown.join(", ")}` +
      `${values.length > shown.length ? `, and ${values.length - shown.length} more` : ""}. ` +
      `${(placementRate * 100).toFixed(0)}% of them read as a business function in their own right.` +
      (runnersUp.length > 0
        ? ` "${runnersUp.slice(0, 4).join('", "')}" also looked possible and ${runnersUp.length === 1 ? "was" : "were"} not used.`
        : ""),
    effect:
      `Every function comparison on the findings screen is made across these values. If this is the ` +
      `wrong column, name the right one in the instructions box and upload again.`,
  });
}

/**
 * The columns of a file, each with a sample of what is in it, offered as the
 * answer to "which one is the department".
 *
 * The sample is the point. Atlas has already failed to decide this from the
 * column names, so a list of the same names is no help — what the client
 * recognises is their own data: seeing "Finance, Operations, People" next to
 * a column called "Grp3" answers the question instantly, and seeing "Hourly,
 * Annually" next to "RateUnit" shows why it was not taken.
 */
function columnChoices(
  rows: Record<string, string>[],
  headers: string[],
  filename: string
): NoteOption[] {
  const choices: NoteOption[] = [];

  for (const column of headers) {
    if (column === SHEET_COLUMN) continue;
    const seen: string[] = [];
    for (const row of rows) {
      const value = (row[column] ?? "").trim();
      if (value && !seen.includes(value)) seen.push(value);
      if (seen.length === 4) break;
    }
    if (seen.length === 0) continue;
    choices.push({
      from: column,
      to: seen.join(", ").slice(0, 70),
      seenIn: filename,
    });
  }

  // Always last, and always present: a file that genuinely carries no
  // department needs an answer that says so, or the question is asked again
  // on every re-read for the rest of the establishment's life.
  choices.push({
    from: NO_DEPARTMENT,
    to: "read each person's function from their job title instead",
    seenIn: filename,
  });

  return choices;
}

/**
 * Asks which column holds the department, when Atlas could not settle it.
 *
 * This is the single most consequential gap a file can have — it is what the
 * whole comparison is cut by — so it is asked rather than guessed at, and the
 * question shows the client their own columns and values rather than
 * explaining what a department is.
 *
 * Real files put it in places no rule reaches: inside "Job Title" as
 * "HCP Team Lead" or "Finance", in a column named after a system rather than
 * a concept, or nowhere at all. Any column can be chosen, including the job
 * title — the client knows their export and Atlas does not.
 */
export function departmentQuestion(
  rows: Record<string, string>[],
  headers: string[],
  filename: string,
  reason: { found: string | null; why: "none" | "guessed" | "contradicted" }
): IngestNote {
  const statement =
    reason.why === "none"
      ? `Atlas found nothing in "${filename}" saying which part of the organisation each person works in.`
      : reason.why === "guessed"
        ? `Nothing in "${filename}" is named as a department, so Atlas took "${reason.found}" on the strength of what is in it.`
        : `Atlas took "${reason.found}" as the department in "${filename}", but the job titles inside it mostly belong to other functions.`;

  const evidence =
    reason.why === "none"
      ? `All ${headers.length} columns were checked by name and by contents. None is named as a ` +
        `department, and none holds values that read as department names.`
      : reason.why === "guessed"
        ? `Its values look like department names, but its column name says nothing — so this is a ` +
          `reading rather than something your file states.`
        : `A column naming places or service lines rather than functions is a real thing to record, ` +
          `and it is not what a function comparison can be built on.`;

  return note(`department-column:${filename}`, "question", {
    topic: `Which column is the department in ${filename}?`,
    statement,
    evidence,
    effect:
      `Every function comparison on the findings screen is cut by this. Until it is settled, each ` +
      `person's function is read from their job title, which says what they do rather than where ` +
      `they sit. Pick the column below — it can be the job title column, if that is where your ` +
      `departments live.`,
    answerKind: "column",
    options: columnChoices(rows, headers, filename),
  });
}

/** Confirms the client's own answer back to them, so it can be changed. */
export function departmentAnsweredNote(
  filename: string,
  column: string,
  values: string[]
): IngestNote {
  const blank = column === NO_DEPARTMENT;

  return note(`department-column:${filename}`, "assumption", {
    topic: `Department column in ${filename}`,
    statement: blank
      ? `You told Atlas "${filename}" carries no department, so each person's function is read from their job title.`
      : `You told Atlas the department in "${filename}" is the "${column}" column, and it is used ahead of anything Atlas would have picked.`,
    evidence: blank
      ? `No column in the file is read as a department.`
      : `${values.length} distinct value${values.length === 1 ? "" : "s"}: ` +
        `${values.slice(0, 8).join(", ")}${values.length > 8 ? ", …" : ""}.`,
    effect: `Change it below and the files are read again.`,
    answeredWith: blank ? "no department" : column,
  });
}
