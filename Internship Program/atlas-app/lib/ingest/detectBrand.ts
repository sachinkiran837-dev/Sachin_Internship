import { note, type IngestNote } from "./notes";
import type { GroupPlan } from "./plan";

/**
 * Finding which company or brand each person is employed by, without being
 * told where to look.
 *
 * A group client's establishment nearly always carries this somewhere — a
 * "Company" column in the payroll extract, an "Entity" column in the
 * establishment list, or one worksheet per trading name. Until now Atlas only
 * consolidated when the person uploading said so in the instructions box,
 * which meant the common case of "here is our group's payroll" produced one
 * undifferentiated tree with three chief executives fighting over the top of
 * it.
 *
 * Detection is deliberately conservative. Consolidating restructures the whole
 * map, so a wrong guess is expensive and obvious, and the guards below exist to
 * make each specific way of being wrong impossible rather than unlikely:
 * a column of employee IDs is not a brand, a column that is 99% one value is
 * not a brand, and a column two thirds of the establishment leaves blank
 * cannot be one either. Anything Atlas does decide is registered as an
 * assumption, because it is a reading rather than something the file states.
 */

/**
 * What organisations call the legal entity or trading name someone works for.
 *
 * Ordered by how unambiguous each term is. "Company" and "Brand" mean this and
 * essentially nothing else; "business" and "organisation" are looser and sit
 * lower, so a file carrying both a "Company" and an "Organisation" column
 * consolidates on the one that actually means it.
 */
const BRAND_TERMS: { term: string; label: string; weight: number }[] = [
  { term: "brand", label: "Brand", weight: 10 },
  { term: "trading name", label: "Brand", weight: 10 },
  { term: "company", label: "Company", weight: 9 },
  { term: "company name", label: "Company", weight: 9 },
  { term: "legal entity", label: "Entity", weight: 9 },
  { term: "entity", label: "Entity", weight: 8 },
  { term: "employer", label: "Employer", weight: 8 },
  { term: "employing entity", label: "Entity", weight: 8 },
  { term: "operating company", label: "Company", weight: 8 },
  { term: "opco", label: "Company", weight: 7 },
  { term: "subsidiary", label: "Company", weight: 7 },
  { term: "business name", label: "Company", weight: 7 },
  { term: "organisation", label: "Organisation", weight: 4 },
  { term: "organization", label: "Organisation", weight: 4 },
];

/**
 * The column the spreadsheet reader adds when it stacks one worksheet per
 * trading name. A workbook split that way usually carries the brand nowhere
 * else at all, so the sheet name is the only record of it — but it is the
 * weakest signal here, because a workbook can just as easily be split by month
 * or by site, so a real brand column always wins.
 */
const SHEET_COLUMN = "Source sheet";

/** Guards, each closing off one specific way of being wrong. */
const RULES = {
  /** Two groups, or there is nothing to consolidate. */
  minGroups: 2,
  /** More than this and it is a department list or an ID column, not a brand. */
  maxGroups: 40,
  /** A brand with one person in it is a typo or a leaver, not a trading name. */
  minRowsPerGroup: 2,
  /** Below this the column describes a fraction of the establishment. */
  minCoverage: 0.6,
  /** Above this the column is closer to unique per row than shared — an identifier. */
  maxDistinctRatio: 0.25,
  /** One value covering nearly everything means the others are noise. */
  maxDominantShare: 0.97,
};

function normalise(header: string): string {
  return header
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** How strongly a header says "this is the company someone works for". */
function score(header: string): { label: string; weight: number } | null {
  const h = normalise(header);
  let best: { label: string; weight: number } | null = null;

  for (const { term, label, weight } of BRAND_TERMS) {
    // Exact beats contained, so "Company" outranks "Company Car Allowance".
    const hit = h === term ? weight + 5 : h.includes(term) ? weight * (term.length / h.length) : 0;
    if (hit > 0 && (!best || hit > best.weight)) best = { label, weight: hit };
  }

  return best;
}

export interface BrandDetection {
  group: GroupPlan;
  /** The column chosen, as it appears in the bound rows. */
  column: string;
  values: string[];
  coverage: number;
  /** Other columns that also looked like a brand and were not used. */
  runnersUp: string[];
}

/**
 * Picks the column that says which company each person works for, or nothing.
 *
 * Only ever called when the person uploading did not say — an explicit
 * instruction always wins, because they know their own data and this does not.
 */
export function detectBrandColumn(
  rows: Record<string, string>[],
  headers: string[]
): BrandDetection | null {
  if (rows.length === 0) return null;

  const candidates = headers
    .map((column) => ({ column, match: column === SHEET_COLUMN ? { label: "Brand", weight: 1 } : score(column) }))
    .filter((c): c is { column: string; match: { label: string; weight: number } } => c.match !== null)
    .sort((a, b) => b.match.weight - a.match.weight);

  if (candidates.length === 0) return null;

  const viable: (BrandDetection & { weight: number })[] = [];

  for (const { column, match } of candidates) {
    const counts = new Map<string, number>();
    let filled = 0;

    for (const row of rows) {
      const value = (row[column] ?? "").trim();
      if (!value) continue;
      filled++;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    const coverage = filled / rows.length;
    if (coverage < RULES.minCoverage) continue;

    // Groups too small to be a trading name are dropped from the count before
    // it is judged, so one mistyped entity does not make a two-brand file look
    // like a three-brand one.
    const real = [...counts.entries()].filter(([, n]) => n >= RULES.minRowsPerGroup);
    if (real.length < RULES.minGroups || real.length > RULES.maxGroups) continue;
    if (counts.size / filled > RULES.maxDistinctRatio) continue;

    const dominant = Math.max(...real.map(([, n]) => n));
    if (dominant / filled > RULES.maxDominantShare) continue;

    viable.push({
      weight: match.weight,
      column,
      values: real.sort((a, b) => b[1] - a[1]).map(([v]) => v),
      coverage,
      runnersUp: [],
      group: {
        columns: [column],
        label: match.label,
        topLabel: "Group",
      },
    });
  }

  if (viable.length === 0) return null;

  const [chosen, ...rest] = viable;
  return { ...chosen, runnersUp: rest.map((r) => r.column) };
}

/**
 * The reading, registered so it can be overruled.
 *
 * Consolidating changes the shape of the map, which changes spans, layers and
 * every comparison built on them — so a client who did not ask for it has to
 * be told it happened, in the one place they are already reading before they
 * trust the numbers.
 */
export function brandNote(detection: BrandDetection): IngestNote {
  const { column, values, group, coverage, runnersUp } = detection;
  const shown = values.slice(0, 6);

  return note("brand-detected", "assumption", {
    topic: `${group.label} read from your data`,
    statement:
      `Nothing in your instructions said which column holds the ${group.label.toLowerCase()} each person works for, ` +
      `so Atlas took the "${column}" column and consolidated the establishment on it. Every position is tagged ` +
      `with its ${group.label.toLowerCase()}, and each one is given its own heading under "${group.topLabel}".`,
    evidence:
      `${values.length} ${group.label.toLowerCase()}${values.length === 1 ? "" : "s"} found — ` +
      `${shown.join(", ")}${values.length > shown.length ? `, and ${values.length - shown.length} more` : ""} — ` +
      `across ${(coverage * 100).toFixed(0)}% of rows.` +
      (runnersUp.length > 0
        ? ` "${runnersUp.join('", "')}" also looked like it could be the ${group.label.toLowerCase()} and ${runnersUp.length === 1 ? "was" : "were"} not used.`
        : ""),
    effect:
      `Without this the group reads as one organisation with ${values.length} people at the top of it, and spans, ` +
      `layers and every comparison are computed across trading names that do not report to each other. ` +
      `If this is the wrong column, name the right one in the instructions box and upload again.`,
  });
}
