/**
 * The hypothesis layer: what the client tells Atlas about the business the
 * establishment belongs to.
 *
 * The upload screen already has a context box, and this is deliberately not
 * it. That one is about *reading* — which file is the structure, what a column
 * means, which rows are out of scope. It has done its job when the map is
 * right. This one is about *meaning*: what the organisation sells, where the
 * revenue comes from, what leadership is trying to get to, and what they
 * already suspect is wrong. None of that can be read off a payroll export, and
 * without it Atlas can count managers but cannot say whether a function is
 * bloated — bloated against what?
 *
 * Everything here is stated by a person, never inferred from the files, and
 * every figure it carries stays labelled with the sentence it came from. A
 * revenue-per-employee comparison built on a number the client typed is a
 * useful thing to put in front of a board; the same comparison built on a
 * number Atlas guessed is a liability.
 */

/** A revenue figure the client supplied, and what it covers. */
export interface RevenueLine {
  /**
   * The unit it belongs to, matched against the establishment's own function
   * or division names. Null means the whole organisation.
   */
  unit: string | null;
  amount: number;
  /** "FY26", "last twelve months", "annualised" — whatever they said. */
  period: string;
  /** The client's own words, kept so the figure can always be traced back. */
  statedAs: string;
}

/** Something leadership is trying to reach. */
export interface Target {
  /** "cost" | "headcount" | "layers" | "other" — what kind of thing is being aimed at. */
  measure: "cost" | "headcount" | "layers" | "span" | "other";
  /** The number, when there is one. Null for a target stated without one. */
  amount: number | null;
  /** "by FY27", "within 18 months" — null when no date was given. */
  horizon: string | null;
  statedAs: string;
}

/**
 * Something the client already thinks is true, which Atlas will test against
 * the establishment rather than repeat back.
 *
 * This is the whole point of asking. A belief that survives contact with the
 * data is worth acting on; one that does not is worth knowing about before
 * a restructure is built on it.
 */
export interface Belief {
  /** The unit it is about, when it names one. */
  unit: string | null;
  /** What kind of claim it is, so the right test can be run against it. */
  about: "management" | "cost" | "productivity" | "workforce-mix" | "structure" | "other";
  statedAs: string;
}

/** Something a redesign is not allowed to touch, in the client's words. */
export interface Constraint {
  unit: string | null;
  statedAs: string;
}

export interface BusinessContext {
  /** Exactly what the client typed. The source of everything below it. */
  raw: string;
  /** What the organisation does, in the client's words. */
  sector: string | null;
  revenue: RevenueLine[];
  targets: Target[];
  beliefs: Belief[];
  constraints: Constraint[];
  /**
   * Things Atlas was told but could not attach to anything — a revenue figure
   * for a unit that isn't in the establishment, a target it couldn't measure.
   * Shown back rather than dropped, because silently ignoring half of what
   * someone wrote is the fastest way to lose their trust in the rest.
   */
  unmatched: string[];
  /** Whether the structured facts were read out of the prose, or none were. */
  source: "ai" | "none";
}

export const EMPTY_BUSINESS: BusinessContext = {
  raw: "",
  sector: null,
  revenue: [],
  targets: [],
  beliefs: [],
  constraints: [],
  unmatched: [],
  source: "none",
};

export function hasBusinessContext(business: BusinessContext): boolean {
  return business.raw.trim().length > 0;
}

/** True once there is enough to say something the establishment alone cannot. */
export function hasStructuredFacts(business: BusinessContext): boolean {
  return (
    business.revenue.length > 0 ||
    business.targets.length > 0 ||
    business.beliefs.length > 0 ||
    business.constraints.length > 0
  );
}

export function parseBusinessContext(raw: string | null | undefined): BusinessContext {
  if (!raw) return EMPTY_BUSINESS;
  try {
    const parsed = JSON.parse(raw) as Partial<BusinessContext>;
    return {
      ...EMPTY_BUSINESS,
      ...parsed,
      revenue: parsed.revenue ?? [],
      targets: parsed.targets ?? [],
      beliefs: parsed.beliefs ?? [],
      constraints: parsed.constraints ?? [],
      unmatched: parsed.unmatched ?? [],
    };
  } catch {
    return EMPTY_BUSINESS;
  }
}

/** Total revenue as stated — the organisation-wide line, or the sum of the units. */
export function totalRevenue(business: BusinessContext): number | null {
  const whole = business.revenue.find((r) => r.unit === null);
  if (whole) return whole.amount;
  const parts = business.revenue.filter((r) => r.unit !== null);
  return parts.length === 0 ? null : parts.reduce((sum, r) => sum + r.amount, 0);
}

/** The revenue attached to one unit, matched the way the client wrote it. */
export function revenueFor(business: BusinessContext, unit: string): number | null {
  const fold = (v: string) => v.trim().toLowerCase();
  const line = business.revenue.find((r) => r.unit !== null && fold(r.unit) === fold(unit));
  return line?.amount ?? null;
}
