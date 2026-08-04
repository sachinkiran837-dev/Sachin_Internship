import rules from "@/config/comparison-rules.json";
import spanConfig from "@/config/span-thresholds.json";
import { tagNodes } from "@/lib/graph/tagging";
import type { LayoutNode, Position, SpanThresholds } from "@/lib/graph/types";
import { revenueFor, type BusinessContext } from "@/lib/hypothesis/context";

/**
 * The organisation compared against itself, function by function.
 *
 * A whole-establishment metric — 1,004 positions, 2.9 average span — tells a
 * client almost nothing they can act on, because nobody restructures an
 * average. What they act on is a part: this function carries a manager for
 * every three people while the rest of the group carries one for every eight,
 * and that gap is worth four roles. So everything here is per unit, and every
 * judgement is relative to the *median unit in this same organisation*.
 *
 * That choice is the whole design. An industry benchmark would let Atlas say
 * "your span is below sector norm", which sounds authoritative and is
 * unfalsifiable in the room — nobody present can check it, and it is a number
 * Atlas would have had to invent or import. A client's own median is a figure
 * they can verify from the table on the same screen, and it survives the
 * obvious objection, because a business cannot argue that its own best-run
 * function is unachievable for its others.
 *
 * Revenue is the one input that cannot come from an establishment file. When
 * the client has supplied it in the hypothesis layer, this engine reports
 * revenue per head and labour as a share of revenue; when they haven't, those
 * fields stay null and the screens say what supplying it would unlock. They
 * are never estimated.
 */

const MIN_UNIT_HEADCOUNT = rules.minUnitHeadcount;
const OUTLIER_MULTIPLE = rules.outlierMultiple;
/**
 * How far above its own median a figure has to sit before Atlas will call it
 * out. Exported because anything that says "the data supports that" has to
 * apply the same bar — a unit a hair above the median is not the expensive
 * one, it is the middle one.
 */
export const COMPARISON_OUTLIER_MULTIPLE = OUTLIER_MULTIPLE;
const MIN_EXCESS_ROLES = rules.minExcessRoles;
const MIN_COVERAGE = rules.minDimensionCoverage;
const MIN_COMPARABLE_UNITS = rules.minComparableUnits;
const SPAN: SpanThresholds = spanConfig;

/**
 * The two ways an establishment can be cut into parts.
 *
 * "function" is the department or cost-centre column, and is what a client
 * means by a function. "division" is the branch of the tree a position hangs
 * from — always available wherever there is a structure, and what Atlas falls
 * back to when no usable function column arrived.
 */
export type UnitDimension = "function" | "division";

export interface UnitProfile {
  key: string;
  headcount: number;
  headcountShare: number;
  fte: number;
  cost: number;
  costShare: number;
  /** How many of this unit's positions carry a cost at all. */
  pricedCount: number;
  /** Cost per contracted FTE, over the priced positions only. */
  costPerFte: number | null;
  /**
   * Share of cost divided by share of people. Above 1 means this unit's
   * people cost more than the organisation's average person; below 1, less.
   */
  costIntensity: number | null;
  managers: number;
  /** Managers as a share of the unit's own headcount — the management-load measure. */
  managerShare: number;
  /** People per manager. Null when the unit has no managers in it. */
  staffPerManager: number | null;
  averageSpan: number;
  layers: number;
  /**
   * What is actually producing the management load, counted rather than
   * characterised.
   *
   * "This function is over-managed" is where most redesign conversations stop
   * and it is the least useful place to stop, because the three things that
   * produce it want three different responses: teams too small to need their
   * own lead get merged, relay layers get removed, and a structure that is
   * simply deep gets compressed. Naming the wrong one produces a change that
   * costs the same and fixes nothing.
   */
  drivers: {
    /** Managers running fewer people than the healthy range. */
    thinSpanManagers: number;
    /** Managers with exactly one report — a layer that relays rather than runs. */
    singleReportManagers: number;
    /** Managers running a healthy or wide span, who are not the problem. */
    healthyManagers: number;
  };
  agency: number;
  agencyShare: number;
  vacant: number;
  protectedCount: number;
  /** False when the unit is too small for its ratios to mean anything. */
  comparable: boolean;
  /** Supplied by the client in the hypothesis layer. Never derived. */
  revenue: number | null;
  revenuePerHead: number | null;
  revenuePerFte: number | null;
  /** Labour cost as a share of this unit's revenue. */
  labourShareOfRevenue: number | null;
}

export interface UnitMedians {
  managerShare: number | null;
  staffPerManager: number | null;
  costPerFte: number | null;
  averageSpan: number | null;
  layers: number | null;
  revenuePerHead: number | null;
}

export interface UnitComparison {
  dimension: UnitDimension;
  /** What to call it on screen — the column's own name where there was one. */
  label: string;
  /** Share of real positions that carried a value for this dimension. */
  coverage: number;
  classified: number;
  unclassified: number;
  units: UnitProfile[];
  comparableUnits: UnitProfile[];
  medians: UnitMedians;
  /** True when there are enough comparable units to say anything relative. */
  usable: boolean;
  /**
   * Why this cut was the one used, stated so it can be put on the screen.
   * Filled in by analyseFunctions, which is the only thing that can know —
   * the choice is made by comparing the cuts against each other.
   */
  choice: string;
  /** Why it isn't usable, when it isn't. */
  limitation: string | null;
  totals: {
    headcount: number;
    fte: number;
    cost: number;
    revenue: number | null;
  };
}

/* ------------------------------------------------------------------ */
/* choosing what a "function" is in this establishment                  */
/* ------------------------------------------------------------------ */

const UNCLASSIFIED = new Set(["", "unclassified", "unknown", "n/a", "none", "-"]);

function hasValue(v: string): boolean {
  return !UNCLASSIFIED.has(v.trim().toLowerCase());
}

/**
 * The division a position sits in: the branch of the tree it hangs from,
 * walked up to the node just below the top.
 *
 * On a consolidated establishment that branch is the brand heading Atlas
 * added, which is exactly the cut a group client wants — one trading name against
 * another. On a single-entity chart it is the executive's directorate, which
 * is the same question asked one level down.
 */
export function divisionOf(nodes: LayoutNode[], rootId: string | null): Map<string, string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const division = new Map<string, string>();

  for (const node of nodes) {
    let current: LayoutNode | undefined = node;
    let parent = current.managerId ? byId.get(current.managerId) : undefined;

    // Climb until the next step up would be the root, or we run out of tree.
    const seen = new Set<string>([node.id]);
    while (parent && parent.id !== rootId && parent.managerId && !seen.has(parent.id)) {
      seen.add(parent.id);
      current = parent;
      parent = current.managerId ? byId.get(current.managerId) : undefined;
    }

    // A position that is itself the root, or a direct report of it, is its own
    // division rather than being folded into a sibling's.
    division.set(node.id, current.id === node.id && node.id === rootId ? node.title : current.title);
  }

  return division;
}

/* ------------------------------------------------------------------ */
/* profiles                                                            */
/* ------------------------------------------------------------------ */

function median(values: number[]): number | null {
  const usable = values.filter((v) => Number.isFinite(v));
  if (usable.length === 0) return null;
  const sorted = [...usable].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function profile(
  key: string,
  members: LayoutNode[],
  totals: { headcount: number; cost: number },
  business: BusinessContext
): UnitProfile {
  const headcount = members.length;
  const fte = members.reduce((sum, n) => sum + n.fte, 0);
  const cost = members.reduce((sum, n) => sum + n.cost * n.fte, 0);

  const priced = members.filter((n) => n.cost > 0);
  const pricedFte = priced.reduce((sum, n) => sum + n.fte, 0);
  const pricedCost = priced.reduce((sum, n) => sum + n.cost * n.fte, 0);

  const managers = members.filter((n) => n.childIds.length > 0);
  const depths = members.map((n) => n.depth);

  const thinSpanManagers = managers.filter((n) => n.childIds.length < SPAN.healthyMin).length;
  const singleReportManagers = managers.filter((n) => n.childIds.length === 1).length;

  const headcountShare = totals.headcount === 0 ? 0 : headcount / totals.headcount;
  const costShare = totals.cost === 0 ? 0 : cost / totals.cost;

  const revenue = revenueFor(business, key);

  return {
    key,
    headcount,
    headcountShare,
    fte,
    cost,
    costShare,
    pricedCount: priced.length,
    // Over the priced positions only. Averaging in the unpriced ones would
    // report a unit as cheap when what it actually is, is unrecorded.
    costPerFte: pricedFte > 0 ? pricedCost / pricedFte : null,
    costIntensity: headcountShare > 0 && totals.cost > 0 ? costShare / headcountShare : null,
    managers: managers.length,
    managerShare: headcount === 0 ? 0 : managers.length / headcount,
    staffPerManager: managers.length === 0 ? null : headcount / managers.length,
    averageSpan:
      managers.length === 0
        ? 0
        : managers.reduce((sum, n) => sum + n.childIds.length, 0) / managers.length,
    layers: headcount === 0 ? 0 : Math.max(...depths) - Math.min(...depths) + 1,
    drivers: {
      thinSpanManagers,
      singleReportManagers,
      healthyManagers: managers.length - thinSpanManagers,
    },
    agency: members.filter((n) => n.status === "contingent").length,
    agencyShare: headcount === 0 ? 0 : members.filter((n) => n.status === "contingent").length / headcount,
    vacant: members.filter((n) => n.status === "vacant").length,
    protectedCount: members.filter((n) => n.flags.protected).length,
    comparable: headcount >= MIN_UNIT_HEADCOUNT,
    revenue,
    revenuePerHead: revenue !== null && headcount > 0 ? revenue / headcount : null,
    revenuePerFte: revenue !== null && fte > 0 ? revenue / fte : null,
    labourShareOfRevenue: revenue !== null && revenue > 0 ? cost / revenue : null,
  };
}

function buildFor(
  dimension: UnitDimension,
  label: string,
  nodes: LayoutNode[],
  keyOf: (n: LayoutNode) => string,
  business: BusinessContext
): UnitComparison {
  const classified = nodes.filter((n) => hasValue(keyOf(n)));
  const coverage = nodes.length === 0 ? 0 : classified.length / nodes.length;

  const totals = {
    headcount: classified.length,
    cost: classified.reduce((sum, n) => sum + n.cost * n.fte, 0),
  };

  const grouped = new Map<string, LayoutNode[]>();
  for (const node of classified) {
    const key = keyOf(node).trim();
    const list = grouped.get(key) ?? [];
    list.push(node);
    grouped.set(key, list);
  }

  const units = [...grouped.entries()]
    .map(([key, members]) => profile(key, members, totals, business))
    .sort((a, b) => b.headcount - a.headcount);

  const comparableUnits = units.filter((u) => u.comparable);

  const medians: UnitMedians = {
    managerShare: median(comparableUnits.map((u) => u.managerShare)),
    staffPerManager: median(
      comparableUnits.filter((u) => u.staffPerManager !== null).map((u) => u.staffPerManager!)
    ),
    costPerFte: median(
      comparableUnits.filter((u) => u.costPerFte !== null).map((u) => u.costPerFte!)
    ),
    averageSpan: median(comparableUnits.filter((u) => u.managers > 0).map((u) => u.averageSpan)),
    layers: median(comparableUnits.map((u) => u.layers)),
    revenuePerHead: median(
      comparableUnits.filter((u) => u.revenuePerHead !== null).map((u) => u.revenuePerHead!)
    ),
  };

  const unitRevenue = units
    .filter((u) => u.revenue !== null)
    .reduce((sum, u) => sum + (u.revenue ?? 0), 0);

  let limitation: string | null = null;
  if (coverage < MIN_COVERAGE) {
    limitation =
      `Only ${(coverage * 100).toFixed(0)}% of positions carry a ${label.toLowerCase()}, so a comparison ` +
      `across ${label.toLowerCase()}s would describe that fraction rather than the organisation.`;
  } else if (comparableUnits.length < MIN_COMPARABLE_UNITS) {
    limitation =
      `${comparableUnits.length} ${label.toLowerCase()}${comparableUnits.length === 1 ? " is" : "s are"} ` +
      `large enough to compare (${MIN_UNIT_HEADCOUNT}+ positions). A median needs at least ` +
      `${MIN_COMPARABLE_UNITS} to be a median of anything.`;
  }

  return {
    dimension,
    label,
    coverage,
    classified: classified.length,
    unclassified: nodes.length - classified.length,
    units,
    comparableUnits,
    medians,
    usable: limitation === null,
    limitation,
    choice: "",
    totals: {
      headcount: classified.length,
      fte: classified.reduce((sum, n) => sum + n.fte, 0),
      cost: totals.cost,
      revenue: unitRevenue > 0 ? unitRevenue : null,
    },
  };
}

export interface FunctionAnalysis {
  /** The cut Atlas used, chosen by which one actually covers the establishment. */
  primary: UnitComparison;
  /** Both cuts, so a client can look at the other one. */
  all: UnitComparison[];
  /** Why the primary was chosen, said plainly. */
  choice: string;
}

/**
 * Cuts the establishment both ways and picks the one that can carry a
 * comparison, saying which and why.
 *
 * A function column is the better cut when it exists, because "Finance is
 * over-managed" is a sentence a client can act on and "the branch under the
 * Group CEO is over-managed" mostly isn't. But a department column that
 * reached a fifth of the establishment is worse than useless — it would
 * describe that fifth and be read as describing the whole. So the choice is
 * made on coverage, not preference, and it is stated on the screen.
 */
export function analyseFunctions(
  positions: Position[],
  rootId: string | null,
  business: BusinessContext
): FunctionAnalysis {
  const tagged = tagNodes(positions, rootId);
  // Heading nodes hold the map together and are not jobs. Counting them would
  // put a "manager" with six reports at the top of every division.
  const nodes = tagged.filter((n) => !n.synthetic);

  const divisions = divisionOf(tagged, rootId);

  // Cut on the rolled-up function, not the raw department. Sixty departments
  // produce sixty units of which fifty are below the size where a ratio means
  // anything, so the comparison would quietly describe whichever teams were
  // large. The rollup is registered on the confirm screen, and the raw
  // department is still on every position for the plays to work on.
  const byFunction = buildFor("function", "Function", nodes, (n) => n.functionGroup, business);
  const byDivision = buildFor(
    "division",
    "Division",
    nodes,
    (n) => divisions.get(n.id) ?? "",
    business
  );

  const all = [byFunction, byDivision];

  // Prefer the function cut when it holds up; fall back to the division cut,
  // and if neither holds up, still return the function cut so the screen can
  // explain what is missing rather than showing nothing.
  const primary = byFunction.usable ? byFunction : byDivision.usable ? byDivision : byFunction;

  const choice = byFunction.usable
    ? `Compared by function, from the department column, which reached ${(byFunction.coverage * 100).toFixed(0)}% of positions.`
    : byDivision.usable
      ? `Compared by division — the branch of the structure each position reports through — because the department column reached only ${(byFunction.coverage * 100).toFixed(0)}% of positions. ` +
        `A function or cost-centre column covering the whole establishment would let Atlas compare Finance against Operations instead.`
      : `Neither cut holds up: ${byFunction.limitation} ${byDivision.limitation}`;

  primary.choice = choice;
  return { primary, all, choice };
}

/**
 * Every name a client could reasonably use for a part of this organisation,
 * across both cuts.
 *
 * Handed to the hypothesis-layer reader so that "Northbrook did about forty
 * million" can be attached to the Northbrook that actually exists, and "Retail did
 * forty million" — where there is no Retail — is reported back as unmatched
 * instead of being snapped onto whichever unit looks closest.
 */
export function unitNames(positions: Position[], rootId: string | null): string[] {
  const { all } = analyseFunctions(positions, rootId, {
    raw: "",
    sector: null,
    revenue: [],
    targets: [],
    beliefs: [],
    constraints: [],
    unmatched: [],
    source: "none",
  });
  return [...new Set(all.flatMap((c) => c.units.map((u) => u.key)))].sort();
}

/* ------------------------------------------------------------------ */
/* the comparisons themselves                                          */
/* ------------------------------------------------------------------ */

export interface ManagementOutlier {
  unit: UnitProfile;
  /** Managers this unit would not carry if it ran at the group's own median. */
  excessManagers: number;
  /** What those roles cost, using this establishment's own manager costs. */
  excessCost: number | null;
  /** The manager cost used, and where it came from. */
  costBasis: string | null;
}

/**
 * Which units carry more management per person than this organisation's own
 * median, and what the difference is worth.
 *
 * The excess is deliberately expressed as roles first and dollars second. Roles
 * are computed from the structure and are hard to argue with; dollars need a
 * manager cost, and where the establishment has not priced its managers Atlas
 * reports the roles and leaves the money blank rather than reaching for a rate.
 */
export function managementOutliers(comparison: UnitComparison): ManagementOutlier[] {
  const { managerShare } = comparison.medians;
  if (!comparison.usable || managerShare === null || managerShare <= 0) return [];

  return comparison.comparableUnits
    .filter((u) => u.managerShare >= managerShare * OUTLIER_MULTIPLE)
    .map((unit) => {
      const atMedian = Math.round(unit.headcount * managerShare);
      const excessManagers = unit.managers - atMedian;
      return { unit, excessManagers, ...managerCostFor(unit, comparison) };
    })
    .filter((o) => o.excessManagers >= MIN_EXCESS_ROLES)
    .sort((a, b) => (b.excessCost ?? 0) - (a.excessCost ?? 0) || b.excessManagers - a.excessManagers);
}

/**
 * What a manager costs in this unit, taken from the unit's own priced
 * managers, then the organisation's, then not at all.
 */
function managerCostFor(
  unit: UnitProfile,
  comparison: UnitComparison
): { excessCost: number | null; costBasis: string | null } {
  const ownMedian = unit.costPerFte;
  if (ownMedian !== null && unit.pricedCount > 0) {
    const atMedian = comparison.medians.managerShare ?? 0;
    const excess = unit.managers - Math.round(unit.headcount * atMedian);
    return {
      excessCost: excess * ownMedian,
      costBasis: `priced at ${unit.key}'s own average cost per FTE, over the ${unit.pricedCount} of its ${unit.headcount} positions that carry a cost`,
    };
  }

  const orgWide = comparison.medians.costPerFte;
  if (orgWide !== null) {
    const atMedian = comparison.medians.managerShare ?? 0;
    const excess = unit.managers - Math.round(unit.headcount * atMedian);
    return {
      excessCost: excess * orgWide,
      costBasis: `priced at the median ${comparison.label.toLowerCase()}'s cost per FTE, because none of ${unit.key}'s own positions carry a cost`,
    };
  }

  return { excessCost: null, costBasis: null };
}

export interface ProductivitySpread {
  best: UnitProfile;
  worst: UnitProfile;
  median: number;
  /** Revenue the lagging unit would carry at the group median, on today's headcount. */
  gapAtMedian: number;
  /** Units with revenue supplied, ranked. */
  ranked: UnitProfile[];
  /** Units the client gave no revenue for, so the ranking's limits are visible. */
  missing: string[];
}

/**
 * Revenue per employee, unit by unit — the one comparison that needs the
 * hypothesis layer, and the one a commercial client asks for first.
 *
 * Returns null rather than a partial answer when fewer than two units carry a
 * revenue figure: a ranking of one is a number, not a comparison.
 */
export function productivitySpread(comparison: UnitComparison): ProductivitySpread | null {
  const withRevenue = comparison.units
    .filter((u) => u.revenuePerHead !== null && u.comparable)
    .sort((a, b) => b.revenuePerHead! - a.revenuePerHead!);

  if (withRevenue.length < MIN_COMPARABLE_UNITS) return null;

  const med = median(withRevenue.map((u) => u.revenuePerHead!))!;
  const best = withRevenue[0];
  const worst = withRevenue[withRevenue.length - 1];

  return {
    best,
    worst,
    median: med,
    gapAtMedian: Math.max(0, med * worst.headcount - (worst.revenue ?? 0)),
    ranked: withRevenue,
    missing: comparison.units
      .filter((u) => u.revenue === null && u.comparable)
      .map((u) => u.key),
  };
}

/** Units whose share of cost runs well ahead of their share of people. */
export function costIntensityOutliers(comparison: UnitComparison): UnitProfile[] {
  if (!comparison.usable) return [];
  return comparison.comparableUnits
    .filter((u) => u.costIntensity !== null && u.costIntensity >= OUTLIER_MULTIPLE && u.pricedCount > 0)
    .sort((a, b) => (b.costIntensity ?? 0) - (a.costIntensity ?? 0));
}

/** B2: units running deeper than this organisation's own median unit. */
export function layerOutliers(comparison: UnitComparison): UnitProfile[] {
  const { layers: medianLayers } = comparison.medians;
  if (!comparison.usable || medianLayers === null) return [];
  return comparison.comparableUnits
    .filter((u) => u.layers > medianLayers)
    .sort((a, b) => b.layers - a.layers);
}

/** Units leaning on agency labour harder than the rest of the organisation. */
export function agencyConcentration(comparison: UnitComparison): UnitProfile[] {
  if (!comparison.usable) return [];
  const shares = comparison.comparableUnits.map((u) => u.agencyShare);
  const med = median(shares);
  if (med === null) return [];
  return comparison.comparableUnits
    .filter((u) => u.agency > 0 && u.agencyShare > Math.max(med * OUTLIER_MULTIPLE, med + 0.05))
    .sort((a, b) => b.agencyShare - a.agencyShare);
}

/** The rules above, stated in words, so a screen can show its own workings. */
export const COMPARISON_METHOD =
  `Almost every comparison here is against this organisation's own median unit, never an external benchmark. ` +
  `A unit needs ${MIN_UNIT_HEADCOUNT} or more positions before it is compared at all, and at least ` +
  `${MIN_COMPARABLE_UNITS} units must clear that bar before a median means anything. A unit is called out ` +
  `when it sits ${((OUTLIER_MULTIPLE - 1) * 100).toFixed(0)}% or more above that median and the gap is ` +
  `worth at least ${MIN_EXCESS_ROLES} role. The handful marked "External reference" or "Back-office ` +
  `benchmarks" are the stated exceptions — a peer band, not this organisation's own figure.`;
