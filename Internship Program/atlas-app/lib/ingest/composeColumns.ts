import { mapColumns } from "./columnMapper";
import type { ParsedFile } from "./parseFile";

/**
 * Builds the columns an establishment needs out of the columns a payroll
 * system actually exports.
 *
 * HR systems store a person's name in two or three fields because that is how
 * you address a letter, and an hourly worker's pay as a rate because that is
 * how you run a timesheet. Neither is what an org map needs, and neither can
 * be fixed by mapping a column to a field — the value has to be built. Doing
 * it here, once, right after the file is read, means everything downstream
 * (the column mapper, the binder, the graph builder, the per-file report)
 * sees an ordinary establishment column and needs to know nothing about
 * where it came from.
 *
 * Every composed column is added, never substituted: the original columns
 * stay in the file and stay visible on the confirm screen, so a client can
 * see both what they sent and what Atlas made of it.
 */

/** What was built, in plain words, for the conversion note. */
export interface Composition {
  column: string;
  detail: string;
}

const FIRST_NAME = ["first name", "firstname", "given name", "givenname", "forename", "preferred name"];
const LAST_NAME = ["last name", "lastname", "surname", "family name", "familyname"];

/** Full-name headers, so a file that already has one is left alone. */
const FULL_NAME = ["name", "employee name", "full name", "worker", "person", "incumbent", "employee"];

const RATE = ["rate", "hourly rate", "pay rate", "base rate", "rate of pay"];
const RATE_UNIT = ["rate unit", "rateunit", "pay basis", "rate type", "pay frequency", "unit"];

export const COMPOSED_NAME = "Employee Name";
/**
 * Named as an exact match for the cost field's synonyms, so that when a file
 * carries both this and the raw column it was derived from, the column mapper
 * picks this one on merit rather than on which came first.
 */
export const COMPOSED_COST = "Fully Loaded Cost";

const normalise = (header: string) =>
  header.trim().toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");

function find(headers: string[], names: string[]): string | null {
  return headers.find((h) => names.includes(normalise(h))) ?? null;
}

export interface ComposeOptions {
  /**
   * Hours a full-time person is paid for in a week, used to turn an hourly
   * rate into an annual cost. An assumption, so it is named wherever the
   * figure is shown rather than buried here.
   */
  fullTimeHoursPerWeek: number;
  /**
   * Hours a week assumed for a casual — someone paid by the hour whose FTE
   * is recorded as zero because they have no guaranteed hours. Zero would
   * price them at nothing; treating them as full-time would overstate the
   * establishment by hundreds of people.
   */
  casualHoursPerWeek: number;
  weeksPerYear: number;
}

export function composeColumns(file: ParsedFile, options: ComposeOptions): ParsedFile {
  const compositions: Composition[] = [];
  let { headers, rows } = file;

  const name = composeName(headers, rows);
  if (name) {
    ({ headers, rows } = name);
    compositions.push(name.composition);
  }

  // Either a file states a rate and Atlas works out a cost, or it states a
  // cost and Atlas works out what basis that cost is on. Never both: the
  // second would re-scale a figure the first just built.
  const cost = composeAnnualCost(headers, rows, options) ?? normaliseCostBasis(headers, rows);
  if (cost) {
    ({ headers, rows } = cost);
    compositions.push(cost.composition);
  }

  if (compositions.length === 0) return file;

  return {
    headers,
    rows,
    conversion: {
      ...file.conversion,
      detail: `${file.conversion.detail} ${compositions.map((c) => c.detail).join(" ")}`,
    },
  };
}

interface Composed {
  headers: string[];
  rows: Record<string, string>[];
  composition: Composition;
}

/** "Melanie" + "Hawkesford" → "Melanie Hawkesford". */
function composeName(headers: string[], rows: Record<string, string>[]): Composed | null {
  if (find(headers, FULL_NAME)) return null;

  const first = find(headers, FIRST_NAME);
  const last = find(headers, LAST_NAME);
  if (!first || !last) return null;

  const composed = rows.map((row) => ({
    ...row,
    [COMPOSED_NAME]: [row[first], row[last]].map((v) => (v ?? "").trim()).filter(Boolean).join(" "),
  }));

  return {
    // First, so it reads as the identity of the row rather than an afterthought.
    headers: [COMPOSED_NAME, ...headers],
    rows: composed,
    composition: {
      column: COMPOSED_NAME,
      detail:
        `Names arrived split across "${first}" and "${last}", so Atlas joined them into a single ` +
        `"${COMPOSED_NAME}" column — without it every position would carry only a first name, and ` +
        `nothing could be matched to it by name.`,
    },
  };
}

/**
 * An hourly rate is not a cost. Turning one into the other takes an
 * assumption about hours, which is exactly the kind of figure this app keeps
 * in the open: the number is stated wherever the cost is shown, so a client
 * can argue with it instead of discovering it.
 */
function composeAnnualCost(
  headers: string[],
  rows: Record<string, string>[],
  options: ComposeOptions
): Composed | null {
  const rate = find(headers, RATE);
  if (!rate) return null;

  const unitColumn = find(headers, RATE_UNIT);
  const hourly = (row: Record<string, string>) =>
    unitColumn ? /hour/i.test(row[unitColumn] ?? "") : true;

  // Nothing to do for a file whose rates are already annual.
  if (!rows.some(hourly)) return null;

  const { fullTimeHoursPerWeek, casualHoursPerWeek, weeksPerYear } = options;
  let casuals = 0;
  let costed = 0;

  const composed = rows.map((row) => {
    const amount = Number((row[rate] ?? "").replace(/[^0-9.\-]/g, ""));
    if (!hourly(row) || !Number.isFinite(amount) || amount <= 0) {
      return { ...row, [COMPOSED_COST]: "" };
    }

    // Atlas prices a position as cost × FTE, so what is stored here is the
    // full-time rate, not the pro-rated amount — otherwise a 0.6 FTE worker
    // would be discounted twice over.
    //
    // FTE is recorded as 0 for casuals: no guaranteed hours, not no work.
    // There is no full-time rate to state for them, so their assumed weekly
    // hours are baked in here and their FTE reads as 1.
    const fte = Number((row.FTE ?? row.fte ?? "").toString().replace(/[^0-9.]/g, ""));
    const casual = !(Number.isFinite(fte) && fte > 0);
    if (casual) casuals++;
    costed++;

    const weekly = casual ? casualHoursPerWeek : fullTimeHoursPerWeek;
    return { ...row, [COMPOSED_COST]: String(Math.round(amount * weekly * weeksPerYear)) };
  });

  return {
    headers: [...headers, COMPOSED_COST],
    rows: composed,
    composition: {
      column: COMPOSED_COST,
      detail:
        `Pay arrived as an hourly rate in "${rate}", which is not a cost, so Atlas annualised it into ` +
        `"${COMPOSED_COST}": rate × hours × ${weeksPerYear} weeks, at ${fullTimeHoursPerWeek} hours a week ` +
        `for a full-time equivalent` +
        (casuals > 0
          ? ` and ${casualHoursPerWeek} hours a week for the ${casuals} of ${costed} paid staff recorded at zero FTE, who are casuals rather than unpaid.`
          : `.`) +
        ` Those hours are an assumption, not something the file states — change them if Kinyara's are different, and every cost below moves with them.`,
    },
  };
}

const median = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const amountOf = (value: string): number => Number((value ?? "").replace(/[^0-9.\-]/g, ""));

/** Below this an FTE is a part-timer rather than a rounding of full time. */
const PART_TIME_CEILING = 0.95;

/** Fewer than this on either side and the comparison is noise, not evidence. */
const MIN_SAMPLE = 5;

/**
 * Works out what a file's cost column actually means, because two payroll
 * systems mean opposite things by it and getting it backwards moves every
 * number on every screen.
 *
 * Atlas prices a position as cost × FTE, which assumes the cost column holds
 * a *full-time rate*. Plenty of exports instead hold what the person is
 * actually paid, already reduced for their hours — and multiplying that by
 * their FTE again prices a 0.26 FTE nurse on $26,629 at $6,924.
 *
 * The two are told apart by evidence in the file rather than by assumption.
 * If the cost column is a full-time rate, part-timers and full-timers are
 * paid about the same headline figure. If it is already pro-rated, the
 * part-timers' figures are lower by roughly their FTE. Comparing the median
 * of each against the median part-time FTE says which hypothesis the file
 * supports; where it supports neither clearly, nothing is changed.
 */
function normaliseCostBasis(
  headers: string[],
  rows: Record<string, string>[]
): Composed | null {
  const mapping = mapColumns(headers);
  const costColumn = mapping.find((m) => m.targetField === "cost")?.sourceColumn;
  const fteColumn = mapping.find((m) => m.targetField === "fte")?.sourceColumn;
  if (!costColumn || !fteColumn) return null;

  const observed = rows
    .map((r) => ({ cost: amountOf(r[costColumn]), fte: amountOf(r[fteColumn]) }))
    .filter((r) => r.cost > 0 && r.fte > 0);

  const part = observed.filter((r) => r.fte < PART_TIME_CEILING);
  const full = observed.filter((r) => r.fte >= PART_TIME_CEILING);
  if (part.length < MIN_SAMPLE || full.length < MIN_SAMPLE) return null;

  const partCost = median(part.map((r) => r.cost));
  const fullCost = median(full.map((r) => r.cost));
  const partFte = median(part.map((r) => r.fte));
  if (fullCost <= 0) return null;

  const ratio = partCost / fullCost;

  // Whichever hypothesis the ratio sits closer to wins. A file where it sits
  // between the two is genuinely ambiguous and is left exactly as it is.
  if (Math.abs(ratio - partFte) >= Math.abs(ratio - 1)) return null;

  const composed = rows.map((row) => {
    const cost = amountOf(row[costColumn]);
    const fte = amountOf(row[fteColumn]);
    return {
      ...row,
      [COMPOSED_COST]: cost > 0 && fte > 0 ? String(Math.round(cost / fte)) : String(cost || ""),
    };
  });

  return {
    headers: [...headers, COMPOSED_COST],
    rows: composed,
    composition: {
      column: COMPOSED_COST,
      detail:
        `"${costColumn}" holds what each person is actually paid, already reduced for their hours — ` +
        `part-timers here earn ${(ratio * 100).toFixed(0)}% of what full-timers do, against a median part-time ` +
        `FTE of ${partFte.toFixed(2)}. Atlas prices a position as cost × FTE, so it divided that figure back ` +
        `out to a full-time rate in "${COMPOSED_COST}"; the arithmetic returns each person to what the file ` +
        `says they cost. Without this every part-timer would have been discounted twice.`,
    },
  };
}
