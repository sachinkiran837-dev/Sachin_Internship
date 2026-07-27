import { mapColumns } from "./columnMapper";
import type { ParsedFile } from "./parseFile";
import { note, type IngestNote } from "./notes";
import type { IngestAnswers } from "./answers";

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
 *
 * Nothing here is built on a number Atlas brought with it. A cost is composed
 * only where the file's own columns say what the pay figure means; where they
 * don't, the cost is left empty and a question is raised, because a plausible
 * figure that nobody can trace is worse to a client than a visible gap.
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

const RATE = ["rate", "hourly rate", "pay rate", "base rate", "rate of pay", "annual rate"];
const RATE_UNIT = ["rate unit", "rateunit", "pay basis", "rate type", "pay frequency", "unit"];

export const COMPOSED_NAME = "Employee Name";
/**
 * Named as an exact match for the cost field's synonyms, so that when a file
 * carries both this and the raw column it was derived from, the column mapper
 * picks this one on merit rather than on which came first.
 */
export const COMPOSED_COST = "Fully Loaded Cost";

/**
 * Weeks in a year. This is the one figure in the file that Atlas supplies
 * itself, and it is a property of the calendar rather than of the client:
 * every annualisation below is rate × hours × 52. The hours are never
 * supplied this way — they are the client's to state.
 */
const WEEKS_PER_YEAR = 52;

const normalise = (header: string) =>
  header.trim().toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");

function find(headers: string[], names: string[]): string | null {
  return headers.find((h) => names.includes(normalise(h))) ?? null;
}

export function composeColumns(
  file: ParsedFile,
  answers: IngestAnswers,
  /**
   * Named in every note this raises. A register that says "the salary column
   * is pro-rated" is unactionable across a five-file upload — the client has
   * to know which of their exports Atlas is talking about.
   */
  filename = "this file"
): ParsedFile {
  const compositions: Composition[] = [];
  const notes: IngestNote[] = [];
  let { headers, rows } = file;

  const name = composeName(headers, rows);
  if (name) {
    ({ headers, rows } = name);
    compositions.push(name.composition);
  }

  // Either a file states a rate and Atlas works out a cost from what the file
  // says that rate means, or it states a cost outright — after which the
  // question is what basis the cost is on. Both paths end at the same column.
  const fromRate = composeCostFromRate(headers, rows, answers, filename);
  if (fromRate) {
    ({ headers, rows } = fromRate);
    compositions.push(fromRate.composition);
    notes.push(...fromRate.notes);
  }

  const rebased = normaliseCostBasis(headers, rows, filename);
  if (rebased) {
    ({ headers, rows } = rebased);
    compositions.push(rebased.composition);
    notes.push(rebased.note);
  }

  if (compositions.length === 0 && notes.length === 0) return file;

  return {
    headers,
    rows,
    notes: [...(file.notes ?? []), ...notes],
    conversion: {
      ...file.conversion,
      detail: compositions.length
        ? `${file.conversion.detail} ${compositions.map((c) => c.detail).join(" ")}`
        : file.conversion.detail,
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

const amountOf = (value: string): number => Number((value ?? "").replace(/[^0-9.\-]/g, ""));

type PayBasis = "annual" | "hourly" | "unknown";

/**
 * What one row's pay figure means, taken from the file rather than from its
 * size. A column that states the basis is read; failing that, a rate column
 * whose *header* states it ("Hourly Rate") is read. Nothing is inferred from
 * the magnitude of the number: a $52,000 figure is a salary in one file and a
 * daily contractor rate in another, and Atlas has no way to tell them apart
 * that would survive being wrong.
 */
function basisReader(
  headers: string[],
  rateColumn: string
): { read: (row: Record<string, string>) => PayBasis; source: string | null } {
  const unitColumn = find(headers, RATE_UNIT);
  if (unitColumn) {
    return {
      source: `the "${unitColumn}" column`,
      read: (row) => {
        const unit = (row[unitColumn] ?? "").toLowerCase();
        if (/hour/.test(unit)) return "hourly";
        if (/annual|year|salar|p\.?a\.?/.test(unit)) return "annual";
        return "unknown";
      },
    };
  }

  const header = normalise(rateColumn);
  if (/hour/.test(header)) return { source: `the "${rateColumn}" column's own name`, read: () => "hourly" };
  if (/annual|year|salar/.test(header)) {
    return { source: `the "${rateColumn}" column's own name`, read: () => "annual" };
  }

  return { source: null, read: () => "unknown" };
}

interface CostFromRate extends Composed {
  notes: IngestNote[];
}

/**
 * Turns a pay rate into an annual cost, but only as far as the file's own
 * evidence reaches.
 *
 * Rows the file says are annual are already the figure Atlas wants. Rows it
 * says are hourly are not, and turning one into the other takes a number of
 * paid hours that no payroll export in this shape carries. Atlas does not
 * supply that number. It leaves those rows uncosted, states how many and what
 * they are worth per hour, and asks — and once the client answers, the same
 * rows are priced on the client's figure and the note says so.
 */
function composeCostFromRate(
  headers: string[],
  rows: Record<string, string>[],
  answers: IngestAnswers,
  filename: string
): CostFromRate | null {
  const rate = find(headers, RATE);
  if (!rate) return null;

  // A file that already carries an outright cost column doesn't need one built.
  const existing = mapColumns(headers).find((m) => m.targetField === "cost")?.sourceColumn;
  if (existing && existing !== rate) return null;

  const { read, source } = basisReader(headers, rate);
  const bases = rows.map(read);
  const counts = {
    annual: bases.filter((b) => b === "annual").length,
    hourly: bases.filter((b) => b === "hourly").length,
    unknown: bases.filter((b) => b === "unknown").length,
  };

  if (counts.annual === 0 && counts.hourly === 0) {
    // Nothing in the file says what this column is. Composing anything from
    // it would be inventing the meaning of every number in it.
    return {
      headers,
      rows,
      composition: {
        column: rate,
        detail: `Atlas found a "${rate}" column but nothing in the file saying whether it is an hourly rate or an annual salary, so it was not read as a cost.`,
      },
      notes: [
        note(`pay-basis:${filename}`, "question", {
          topic: `What "${rate}" means in ${filename}`,
          statement: `Atlas left the "${rate}" column out of every cost on the following screens.`,
          evidence:
            `${rows.length.toLocaleString()} rows in "${filename}" carry a "${rate}" value, and no column ` +
            `in it states whether that is an hourly rate, a daily rate or an annual salary.`,
          effect:
            `Every position from this file models at $0, which understates the establishment and every ` +
            `saving measured against it. Tell Atlas what the column is and it will be priced.`,
        }),
      ],
    };
  }

  const hours = answers.hoursPerWeek;
  let costedAnnual = 0;
  let costedHourly = 0;
  const uncosted: { rate: number; fte: number }[] = [];

  const composed = rows.map((row, i) => {
    const amount = amountOf(row[rate]);
    if (!Number.isFinite(amount) || amount <= 0) return { ...row, [COMPOSED_COST]: "" };

    if (bases[i] === "annual") {
      costedAnnual++;
      return { ...row, [COMPOSED_COST]: String(Math.round(amount)) };
    }

    if (bases[i] === "hourly" && hours !== null) {
      costedHourly++;
      return { ...row, [COMPOSED_COST]: String(Math.round(amount * hours * WEEKS_PER_YEAR)) };
    }

    if (bases[i] === "hourly") {
      uncosted.push({ rate: amount, fte: amountOf(row.FTE ?? row.fte ?? "") });
    }
    return { ...row, [COMPOSED_COST]: "" };
  });

  const notes: IngestNote[] = [];

  if (hours !== null && costedHourly > 0) {
    notes.push(
      note("paid-hours", "assumption", {
        topic: "Paid hours",
        statement: `Hourly rates were annualised at ${hours} paid hours a week, because you told Atlas that is a full-time week here.`,
        evidence:
          `${costedHourly.toLocaleString()} rows in "${filename}" state an hourly rate. Each is now ` +
          `rate × ${hours} × ${WEEKS_PER_YEAR} weeks, held as a full-time figure so that Atlas's ` +
          `cost × FTE arithmetic doesn't discount a part-timer twice.`,
        effect: `Changing the hours moves every one of those ${costedHourly.toLocaleString()} costs proportionally.`,
        answeredWith: `${hours} hours a week`,
      })
    );
  }

  if (uncosted.length > 0) {
    const rates = uncosted.map((u) => u.rate);
    const zeroFte = uncosted.filter((u) => !(u.fte > 0)).length;
    const implied = impliedHours(rows, bases, rate);

    notes.push(
      note("paid-hours", "question", {
        topic: "Paid hours",
        statement: `${uncosted.length.toLocaleString()} people are paid an hourly rate, and Atlas has left every one of them at $0 rather than guess how many hours that rate is paid for.`,
        evidence:
          `In "${filename}", ${source ?? "the file"} marks these rows hourly. They run from ` +
          `$${Math.min(...rates).toFixed(2)} to $${Math.max(...rates).toFixed(2)} an hour, median ` +
          `$${median(rates).toFixed(2)}` +
          (zeroFte > 0
            ? `, and ${zeroFte.toLocaleString()} of them carry 0 FTE — so even priced, they would contribute nothing to a cost × FTE establishment until you say what they are.`
            : `.`) +
          (implied
            ? ` The file offers a hint and no more: ${implied.titles} job titles appear on both an hourly and an annual rate here, implying anything from ${implied.low.toFixed(0)} to ${implied.high.toFixed(0)} hours a week (median ${implied.median.toFixed(0)}). That spread is too wide to price ${uncosted.length.toLocaleString()} people on, so Atlas has not used it.`
            : ` No column in the file states hours, and no job title appears on both an hourly and an annual rate, so there is nothing to derive it from.`),
        effect: `Answer this and all ${uncosted.length.toLocaleString()} are priced at rate × hours × ${WEEKS_PER_YEAR} on the next run. Until then the establishment's cost is the salaried staff only.`,
        answerKind: "hours",
      })
    );
  }

  return {
    headers: headers.includes(COMPOSED_COST) ? headers : [...headers, COMPOSED_COST],
    rows: composed,
    notes,
    composition: {
      column: COMPOSED_COST,
      detail:
        `Pay arrived in a "${rate}" column${source ? `, with ${source} saying what each figure means` : ""}: ` +
        `${costedAnnual.toLocaleString()} annual figure${costedAnnual === 1 ? "" : "s"} taken as-is` +
        (costedHourly > 0
          ? `, and ${costedHourly.toLocaleString()} hourly rate${costedHourly === 1 ? "" : "s"} annualised at the ${hours} hours a week you supplied`
          : uncosted.length > 0
            ? `, and ${uncosted.length.toLocaleString()} hourly rate${uncosted.length === 1 ? "" : "s"} left uncosted — Atlas will not invent the hours behind them`
            : "") +
        `, into "${COMPOSED_COST}".`,
    },
  };
}

/**
 * What the file itself implies a full-time week to be, where a job title
 * appears on both an hourly and an annual rate. Reported as evidence for the
 * client to judge — never applied. Two people doing the same job on different
 * pay arrangements are the closest thing an export like this has to a
 * controlled comparison, and it is still not close enough to price a
 * workforce on.
 */
function impliedHours(
  rows: Record<string, string>[],
  bases: PayBasis[],
  rateColumn: string
): { titles: number; low: number; high: number; median: number } | null {
  const titleColumn = mapColumns(Object.keys(rows[0] ?? {})).find((m) => m.targetField === "title")
    ?.sourceColumn;
  const fteColumn = mapColumns(Object.keys(rows[0] ?? {})).find((m) => m.targetField === "fte")
    ?.sourceColumn;
  if (!titleColumn) return null;

  const hourly = new Map<string, number[]>();
  const annual = new Map<string, number[]>();

  rows.forEach((row, i) => {
    const title = (row[titleColumn] ?? "").trim().toLowerCase();
    const amount = amountOf(row[rateColumn]);
    if (!title || !(amount > 0)) return;
    // Only full-timers on the annual side: a part-timer's stated salary may
    // already be reduced for their hours, which would deflate the comparison.
    const fte = fteColumn ? amountOf(row[fteColumn]) : 1;
    if (bases[i] === "hourly") hourly.set(title, [...(hourly.get(title) ?? []), amount]);
    else if (bases[i] === "annual" && fte >= 0.95) annual.set(title, [...(annual.get(title) ?? []), amount]);
  });

  const implied: number[] = [];
  for (const [title, rates] of hourly) {
    const salaries = annual.get(title);
    if (!salaries || salaries.length === 0) continue;
    implied.push(median(salaries) / (median(rates) * WEEKS_PER_YEAR));
  }

  if (implied.length < 2) return null;
  return {
    titles: implied.length,
    low: Math.min(...implied),
    high: Math.max(...implied),
    median: median(implied),
  };
}

const median = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

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
  rows: Record<string, string>[],
  filename: string
): (Composed & { note: IngestNote }) | null {
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

  const detail =
    `"${costColumn}" holds what each person is actually paid, already reduced for their hours — ` +
    `part-timers here earn ${(ratio * 100).toFixed(0)}% of what full-timers do, against a median part-time ` +
    `FTE of ${partFte.toFixed(2)}. Atlas prices a position as cost × FTE, so it divided that figure back ` +
    `out to a full-time rate in "${COMPOSED_COST}"; the arithmetic returns each person to what the file ` +
    `says they cost. Without this every part-timer would have been discounted twice.`;

  return {
    headers: headers.includes(COMPOSED_COST) ? headers : [...headers, COMPOSED_COST],
    rows: composed,
    composition: { column: COMPOSED_COST, detail },
    note: note(`cost-basis:${filename}`, "assumption", {
      topic: `What "${costColumn}" means in ${filename}`,
      statement: `Atlas read "${costColumn}" as already reduced for each person's hours, and divided it back out to a full-time rate.`,
      evidence:
        `Across ${observed.length.toLocaleString()} rows in that file with both a cost and an FTE, part-timers' figures ` +
        `sit at ${(ratio * 100).toFixed(0)}% of full-timers' against a median part-time FTE of ${partFte.toFixed(2)}. ` +
        `A column holding full-time rates would show the two at roughly parity.`,
      effect:
        `Each person's cost × FTE now returns the figure your file states. Had Atlas read it the other way, ` +
        `every part-timer would have been discounted twice — a 0.4 FTE role at $60,000 would have modelled at $24,000.`,
    }),
  };
}
