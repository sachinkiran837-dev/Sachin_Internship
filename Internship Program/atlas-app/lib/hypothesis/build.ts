import { currency } from "@/lib/format/currency";
import {
  COMPARISON_METHOD,
  COMPARISON_OUTLIER_MULTIPLE,
  agencyConcentration,
  analyseFunctions,
  costIntensityOutliers,
  managementOutliers,
  productivitySpread,
  type FunctionAnalysis,
  type UnitComparison,
  type UnitProfile,
} from "@/lib/analysis/functions";
import { analyseAllPlays, type PlayAnalysis, type PlayMeta } from "@/lib/scenario/plays";
import { computeMetrics } from "@/lib/metrics/diagnostics";
import type { DiagnosticMetrics, Position } from "@/lib/graph/types";
import { totalRevenue, type Belief, type BusinessContext } from "./context";

/**
 * The three questions a restructure conversation actually turns on, answered
 * in that order and never separated:
 *
 *   1. What do we think is happening here?
 *   2. What should we do about it?
 *   3. What do we get if we do?
 *
 * Splitting them is how these projects go wrong. A diagnostic deck with no
 * action is a bill for a slide pack. An action with no diagnosis is a cut
 * looking for a justification. A prize with neither is the number everyone
 * remembers and nobody can defend six months later when it hasn't appeared.
 * So every hypothesis here carries all three, plus the fourth thing that
 * makes it usable in a room: what would have to be true, and what Atlas
 * could not see.
 *
 * The division of labour is the same as everywhere else in Atlas. The
 * observations are computed from the establishment; the comparisons are
 * against the organisation's own median; the interpretation is a sentence
 * built from those figures by rule, not by a model. Where the client's own
 * hypothesis layer supplies something the files cannot — revenue, a target, a
 * suspicion — it is named as theirs, and where it supplies nothing, the
 * hypothesis says what supplying it would unlock rather than guessing.
 */

export interface Signal {
  label: string;
  value: string;
  /** How it sits against the organisation's own median, where that applies. */
  comparison?: string;
}

export type PrizeNature =
  | "cost-out"
  | "cost-avoidance"
  | "cost-rebase"
  | "capacity"
  | "confidence"
  | "none";

export interface Prize {
  /** Null when the prize is real but cannot honestly be priced from this data. */
  amount: number | null;
  nature: PrizeNature;
  statement: string;
}

export type Strength =
  /** Computed from the establishment. Nothing was taken on trust. */
  | "observed"
  /** The client said it; Atlas tested it against the establishment. */
  | "tested"
  /** Real, but Atlas needs something it hasn't been given to size it. */
  | "needs-input";

export interface Hypothesis {
  id: string;
  lens: string;
  /** The part of the organisation it is about, when it is about one. */
  unit: string | null;
  title: string;
  /** 1 — what we think could be happening. */
  thinking: string;
  /** The figures underneath it. */
  signals: Signal[];
  /** 2 — what to do about it. */
  action: string;
  /** The scenario play that models the action, when one does. */
  playId: string | null;
  playName: string | null;
  /** 3 — what we get. */
  prize: Prize;
  /** What has to hold for this to be worth acting on, and what Atlas can't see. */
  conditions: string[];
  strength: Strength;
  /** Set only where the client stated a belief and Atlas tested it. */
  verdict: "supported" | "not supported" | "untestable" | null;
  /** Used to rank. Roughly "how much is on the table", not a confidence score. */
  weight: number;
}

export interface HypothesisResult {
  hypotheses: Hypothesis[];
  analysis: FunctionAnalysis;
  metrics: DiagnosticMetrics;
  plays: { play: PlayMeta; analysis: PlayAnalysis }[];
  /** What Atlas would be able to say if it were given more. */
  wouldUnlock: string[];
  method: string;
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

/**
 * Meaningfully above the organisation's own median, rather than a hair above
 * it.
 *
 * Half of any set of units sits above its own median by construction, so
 * "above the median" is not a finding — it is arithmetic. A claim only earns
 * "the data supports that" at the same distance Atlas would have needed to
 * raise the point unprompted, which keeps a client's hypothesis held to the
 * same bar as Atlas's own.
 *
 * `floor` is an absolute minimum gap, for measures where the median can sit
 * at or near zero and a multiple of it would wave through anything at all.
 */
function above(value: number, median: number, floor = 0): boolean {
  return value >= Math.max(median * COMPARISON_OUTLIER_MULTIPLE, median + floor);
}

/** The same bar, in the other direction. */
function below(value: number, median: number): boolean {
  return value <= median / COMPARISON_OUTLIER_MULTIPLE;
}

/* ------------------------------------------------------------------ */

export function buildHypotheses(
  positions: Position[],
  rootId: string | null,
  business: BusinessContext
): HypothesisResult {
  const metrics = computeMetrics(positions, rootId);
  const analysis = analyseFunctions(positions, rootId, business);
  const plays = analyseAllPlays(positions, rootId);
  const comparison = analysis.primary;

  const findPlay = (id: string) => plays.find((p) => p.play.id === id) ?? null;

  const hypotheses: Hypothesis[] = [
    ...managementLoad(comparison, findPlay),
    ...productivity(comparison, business),
    ...costConcentration(comparison),
    ...agencyReliance(comparison, metrics, findPlay),
    ...structureShape(comparison, metrics, business, findPlay),
    ...beliefTests(business, comparison, metrics),
    ...targetGap(business, plays),
  ];

  return {
    hypotheses: hypotheses.sort(rank),
    analysis,
    metrics,
    plays,
    wouldUnlock: wouldUnlock(analysis, business, metrics),
    method: COMPARISON_METHOD,
  };
}

/**
 * A tested belief outranks everything, because the client asked. After that,
 * money. A hypothesis Atlas cannot size sits below one it can, but above
 * nothing — an unsized gap in the data is still the thing to fix first.
 */
function rank(a: Hypothesis, b: Hypothesis): number {
  const tier = (h: Hypothesis) => (h.verdict !== null ? 0 : h.strength === "needs-input" ? 2 : 1);
  return tier(a) - tier(b) || b.weight - a.weight;
}

/* ------------------------------------------------------------------ */
/* 1. management load — "which function is bloated"                     */
/* ------------------------------------------------------------------ */

type FindPlay = (id: string) => { play: PlayMeta; analysis: PlayAnalysis } | null;

/**
 * What is producing a unit's management load, and therefore what to do about
 * it.
 *
 * The three causes want three different responses and cost the same to get
 * wrong. Teams too small to justify their own lead are merged; managers with
 * a single report are a relay layer and are removed; a unit whose managers
 * all run healthy spans is not over-managed by span at all — it is deep, and
 * the answer is compression. Picking the dominant one is what turns "this
 * function is bloated" into an instruction.
 */
function driverOf(unit: UnitProfile): { driver: string; action: string; playId: string } {
  const { thinSpanManagers, singleReportManagers, healthyManagers } = unit.drivers;

  if (singleReportManagers > 0 && singleReportManagers >= thinSpanManagers / 2) {
    return {
      driver:
        `${singleReportManagers} of ${unit.key}'s ${unit.managers} management roles have exactly one direct ` +
        `report. That is not a team being run, it is a decision being relayed, and it is the clearest ` +
        `cause here.`,
      action:
        `Take the single-report roles first: ask what each one decides that the level above it does not, ` +
        `and where the answer is nothing, move the report up a level and close the post. Nothing below ` +
        `them changes, which makes this the lowest-risk move available.`,
      playId: "pass-through-layers",
    };
  }

  if (thinSpanManagers > 0) {
    return {
      driver:
        `${thinSpanManagers} of ${unit.key}'s ${unit.managers} managers run a team smaller than the healthy ` +
        `range. The load is coming from teams too small to need a lead of their own, not from the layer count.`,
      action:
        `Merge the sub-scale teams into the nearest one doing related work and keep every person in them. ` +
        `What goes is the separate management post, not the team — check the receiving manager stays inside ` +
        `a healthy span before committing to it.`,
      playId: "thin-span-consolidation",
    };
  }

  return {
    driver:
      `All ${healthyManagers} of ${unit.key}'s managers run a healthy span, so the load is not coming from ` +
      `teams that are too small. It is coming from depth — ${unit.layers} layers inside one ${"unit"}.`,
    action:
      `Compress rather than consolidate: take the longest chain from the front line to the top of ` +
      `${unit.key} and remove the step that adds no decision. Merging teams here would make healthy spans ` +
      `wide without removing a layer.`,
    playId: "deep-chain-compression",
  };
}

function managementLoad(comparison: UnitComparison, findPlay: FindPlay): Hypothesis[] {
  const outliers = managementOutliers(comparison);
  if (outliers.length === 0) return [];

  const medianShare = comparison.medians.managerShare ?? 0;
  const medianStaff = comparison.medians.staffPerManager;
  const noun = comparison.label.toLowerCase();

  // The two worst, not all of them. A list of nine "bloated" functions is a
  // list nobody reads and a claim nobody believes.
  return outliers.slice(0, 2).map(({ unit, excessManagers, excessCost, costBasis }) => {
    const { driver, action, playId } = driverOf(unit);
    const play = findPlay(playId) ?? findPlay("manager-ratio");

    return {
      id: `management-load:${unit.key}`,
      lens: "Management load",
      unit: unit.key,
      title: `${unit.key} carries more management than the rest of the group`,
      thinking:
        `${unit.key} runs one manager for every ${(unit.staffPerManager ?? 0).toFixed(1)} people. ` +
        `The median ${noun} in this organisation runs one for every ${(medianStaff ?? 0).toFixed(1)}. ` +
        `Two things usually produce that gap and they need different responses: the work is genuinely ` +
        `more supervision-intensive than the rest of the group, or the layer was added to solve a ` +
        `problem that has since been solved and never taken back out. The structure alone cannot tell ` +
        `you which — but it can tell you the gap is ${excessManagers} role${excessManagers === 1 ? "" : "s"} wide, ` +
        `and it can tell you what is producing it. ${driver}`,
      signals: [
        {
          label: "Management share",
          value: pct(unit.managerShare),
          comparison: `group median ${pct(medianShare)} across ${comparison.comparableUnits.length} comparable ${noun}s`,
        },
        {
          label: "People per manager",
          value: (unit.staffPerManager ?? 0).toFixed(1),
          comparison: `median ${(medianStaff ?? 0).toFixed(1)}`,
        },
        { label: "Average span inside the unit", value: unit.averageSpan.toFixed(1) },
        {
          label: "Managers running a sub-scale team",
          value: `${unit.drivers.thinSpanManagers} of ${unit.managers}`,
          comparison: `${unit.drivers.singleReportManagers} of them have exactly one report`,
        },
        { label: "Layers inside the unit", value: String(unit.layers) },
        { label: "Size", value: `${unit.headcount} positions, ${unit.fte.toFixed(0)} FTE` },
      ],
      action:
        `${action} Model it before you commit to it — the ${play?.play.name ?? "manager-ratio"} play finds ` +
        `the specific roles and prices them.`,
      playId: play?.play.id ?? null,
      playName: play?.play.name ?? null,
      prize: {
        amount: excessCost,
        nature: "cost-out",
        statement:
          excessCost !== null
            ? `${currency(excessCost)} a year if ${unit.key} ran at the group's own median management ` +
              `share — ${excessManagers} fewer management role${excessManagers === 1 ? "" : "s"}, ${costBasis}.`
            : `${excessManagers} fewer management role${excessManagers === 1 ? "" : "s"} if ${unit.key} ran at ` +
              `the group median. Atlas has not put a figure on that because none of these positions carry a cost.`,
      },
      conditions: [
        `That the ${noun} split is the right one to compare across — ${comparison.choice}`,
        unit.protectedCount > 0
          ? `${unit.protectedCount} of ${unit.key}'s roles are protected or governance roles and are excluded from any move.`
          : `None of ${unit.key}'s roles are protected, so all of them are in scope for a redesign.`,
        `That ${unit.key}'s work is not genuinely more supervision-intensive than the rest of the group. If it is, the gap is the cost of doing that work and not a saving.`,
      ],
      strength: "observed",
      verdict: null,
      weight: excessCost ?? excessManagers * 1000,
    };
  });
}

/* ------------------------------------------------------------------ */
/* 2. revenue per employee — needs the hypothesis layer                 */
/* ------------------------------------------------------------------ */

function productivity(comparison: UnitComparison, business: BusinessContext): Hypothesis[] {
  const spread = productivitySpread(comparison);
  const noun = comparison.label.toLowerCase();

  if (!spread) {
    // The absence is worth a card of its own. This is the single highest-value
    // thing a client can hand Atlas, and it costs them one sentence.
    if (!comparison.usable) return [];
    return [
      {
        id: "productivity:needs-revenue",
        lens: "Revenue per employee",
        unit: null,
        title: "Revenue per employee cannot be computed from an establishment file",
        thinking:
          `Atlas can see what each ${noun} costs and how many people are in it, which is half of the ` +
          `most useful ratio in a restructure. The other half — what each ${noun} earns — exists in ` +
          `nobody's payroll export. Without it, every comparison on this screen is about cost and ` +
          `structure, and none of them can distinguish a ${noun} that is expensive from one that is ` +
          `simply carrying the revenue.`,
        signals: [
          {
            label: `${comparison.label}s ready to compare`,
            value: String(comparison.comparableUnits.length),
          },
          {
            label: "Revenue supplied so far",
            value:
              business.revenue.length === 0
                ? "none"
                : `${business.revenue.length} figure${business.revenue.length === 1 ? "" : "s"}, ${
                    business.revenue.filter((r) => r.unit !== null).length
                  } attached to a ${noun}`,
          },
        ],
        action:
          `Add revenue by ${noun} in the business context — one line each is enough ("${
            comparison.comparableUnits[0]?.key ?? "that unit"
          } did about 40m last year"). Atlas will rank every ${noun} by revenue per head and per FTE, show labour ` +
          `as a share of revenue, and size what the lagging ${noun}s would be worth at the group's own median.`,
        playId: null,
        playName: null,
        prize: {
          amount: null,
          nature: "confidence",
          statement:
            `Turns "this ${noun} looks expensive" into "this ${noun} earns ${"X"} per head against a group ` +
            `median of ${"Y"}" — the difference between a cost argument and a productivity one.`,
        },
        conditions: [
          `Revenue has to be attributable to a ${noun}. Where the business genuinely cannot split it, say so and Atlas will compare on cost alone rather than on a split you don't believe.`,
        ],
        strength: "needs-input",
        verdict: null,
        weight: 0,
      },
    ];
  }

  const { best, worst, median, gapAtMedian, ranked, missing } = spread;

  return [
    {
      id: "productivity:spread",
      lens: "Revenue per employee",
      unit: worst.key,
      title: `${best.key} earns ${(best.revenuePerHead! / (worst.revenuePerHead || 1)).toFixed(1)}× what ${worst.key} earns per head`,
      thinking:
        `Across the ${ranked.length} ${noun}s with revenue attached, revenue per head runs from ` +
        `${currency(worst.revenuePerHead!)} in ${worst.key} to ${currency(best.revenuePerHead!)} in ` +
        `${best.key}, against a median of ${currency(median)}. A spread that wide inside one business ` +
        `is rarely about how hard people work. It is usually mix — ${worst.key} carrying more of the ` +
        `low-margin work, or more of the overhead the others are billing through — or it is a genuine ` +
        `difference in how the work is organised. Either way the group's own median is the honest ` +
        `benchmark, because ${best.key} is already achieving it under the same ownership and the same systems.`,
      signals: ranked.slice(0, 6).map((u) => ({
        label: u.key,
        value: `${currency(u.revenuePerHead!)} per head`,
        comparison:
          u.labourShareOfRevenue !== null
            ? `labour is ${pct(u.labourShareOfRevenue)} of its revenue`
            : undefined,
      })),
      action:
        `Take ${worst.key} apart before you take cost out of it: what work sits there that ${best.key} ` +
        `does not carry, and what does ${best.key} charge for that ${worst.key} gives away. If the answer ` +
        `is mix, the move is pricing or portfolio, not headcount. If the answer is structure, the ` +
        `management-load and span findings on this screen are where it will show up.`,
      playId: null,
      playName: null,
      prize: {
        amount: gapAtMedian > 0 ? gapAtMedian : null,
        nature: "capacity",
        statement:
          gapAtMedian > 0
            ? `${currency(gapAtMedian)} of additional revenue if ${worst.key} reached the group's own ` +
              `median revenue per head on the headcount it already has. Not a cost saving — this is ` +
              `revenue the same people would carry.`
            : `${worst.key} is already at or above the group median, so there is no gap to close here.`,
      },
      conditions: [
        `The revenue figures are yours, quoted back: ${business.revenue
          .filter((r) => r.unit !== null)
          .map((r) => `"${r.statedAs}"`)
          .slice(0, 3)
          .join("; ")}.`,
        missing.length > 0
          ? `${missing.length} comparable ${noun}${missing.length === 1 ? "" : "s"} carry no revenue figure and are not in this ranking: ${missing.join(", ")}.`
          : `Every comparable ${noun} carries a revenue figure, so this ranking is complete.`,
        `That revenue and headcount are drawn from the same period. A current establishment against last year's revenue overstates every ratio here.`,
      ],
      strength: "tested",
      verdict: null,
      weight: gapAtMedian,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* 3. cost concentration                                                */
/* ------------------------------------------------------------------ */

function costConcentration(comparison: UnitComparison): Hypothesis[] {
  const outliers = costIntensityOutliers(comparison);
  if (outliers.length === 0) return [];

  const unit = outliers[0];
  const noun = comparison.label.toLowerCase();
  const medianCost = comparison.medians.costPerFte;
  const excess =
    medianCost !== null && unit.costPerFte !== null
      ? (unit.costPerFte - medianCost) * unit.fte
      : null;

  return [
    {
      id: `cost-intensity:${unit.key}`,
      lens: "Cost concentration",
      unit: unit.key,
      title: `${unit.key} takes ${pct(unit.costShare)} of the cost with ${pct(unit.headcountShare)} of the people`,
      thinking:
        `${unit.key}'s people cost ${(unit.costIntensity ?? 1).toFixed(2)}× the organisation's average. ` +
        `That is either seniority — a ${noun} weighted towards senior roles, which is a design choice ` +
        `someone made and can revisit — or it is pay drift, where individual arrangements have moved ` +
        `ahead of the band over time without anyone looking at the total.`,
      signals: [
        { label: "Share of cost", value: pct(unit.costShare) },
        { label: "Share of people", value: pct(unit.headcountShare) },
        {
          label: "Cost per FTE",
          value: unit.costPerFte !== null ? currency(unit.costPerFte) : "not priced",
          comparison: medianCost !== null ? `median ${noun} ${currency(medianCost)}` : undefined,
        },
        {
          label: "Priced positions",
          value: `${unit.pricedCount} of ${unit.headcount}`,
        },
      ],
      action:
        `Pull the band distribution for ${unit.key} against one other ${noun} of similar size. If the ` +
        `shape differs at the top, it is a structure question and belongs with the management-load ` +
        `finding. If the shape is the same and the money is not, it is a remuneration review, and no ` +
        `redesign will fix it.`,
      playId: null,
      playName: null,
      prize: {
        amount: excess !== null && excess > 0 ? excess : null,
        nature: "cost-rebase",
        statement:
          excess !== null && excess > 0
            ? `${currency(excess)} a year is the difference between ${unit.key}'s cost per FTE and the ` +
              `median ${noun}'s, across its ${unit.fte.toFixed(0)} FTE. Treat it as the size of the ` +
              `question, not as a saving — some of it will be seniority the business needs.`
            : `Atlas has not priced this, because ${unit.pricedCount} of ${unit.headcount} positions in ${unit.key} carry a cost.`,
      },
      conditions: [
        unit.pricedCount < unit.headcount
          ? `Only ${unit.pricedCount} of ${unit.key}'s ${unit.headcount} positions carry a cost, so its cost per FTE is computed over those and the share-of-cost figure understates it.`
          : `Every position in ${unit.key} carries a cost, so both figures are complete.`,
        `That cost is recorded on the same basis across ${noun}s. One ${noun} loaded with on-costs and another without would produce this exact pattern and mean nothing.`,
      ],
      strength: "observed",
      verdict: null,
      weight: excess ?? 0,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* 4. workforce mix                                                     */
/* ------------------------------------------------------------------ */

function agencyReliance(
  comparison: UnitComparison,
  metrics: DiagnosticMetrics,
  findPlay: FindPlay
): Hypothesis[] {
  if (metrics.contingentCount === 0) return [];

  const concentrated = agencyConcentration(comparison);
  const play = findPlay("agency-premium");
  const insourcing = findPlay("contractor-insourcing");
  const best = [play, insourcing]
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => b.analysis.projectedSaving - a.analysis.projectedSaving)[0];

  const share = metrics.contingentCount / Math.max(metrics.headcount, 1);
  const noun = comparison.label.toLowerCase();
  const where =
    concentrated.length > 0
      ? `It is not spread evenly: ${concentrated
          .slice(0, 3)
          .map((u) => `${u.key} at ${pct(u.agencyShare)}`)
          .join(", ")}.`
      : `It is spread fairly evenly across the ${noun}s, which points at a group-level sourcing ` +
        `decision rather than a local one.`;

  return [
    {
      id: "workforce-mix:agency",
      lens: "Workforce mix",
      unit: concentrated[0]?.key ?? null,
      title: `${metrics.contingentCount} of ${metrics.headcount} positions are agency, and they carry no contracted FTE`,
      thinking:
        `${pct(share)} of the people on this chart are not employed by the organisation. That is why ` +
        `headcount reads ${metrics.headcount} and the contracted establishment reads ` +
        `${metrics.totalFte.toFixed(0)} FTE — the gap between those two numbers is the agency population. ` +
        `${where} A reliance this size is usually the residue of a hiring freeze or a recruitment ` +
        `problem that was solved tactically and then never revisited, and it is almost always the ` +
        `largest single commercial lever in an establishment like this one.`,
      signals: [
        { label: "Agency positions", value: String(metrics.contingentCount) },
        { label: "Headcount", value: String(metrics.headcount) },
        { label: "Contracted FTE", value: metrics.totalFte.toFixed(0) },
        ...concentrated.slice(0, 3).map((u) => ({
          label: `${u.key} agency share`,
          value: pct(u.agencyShare),
          comparison: `${u.agency} of ${u.headcount} positions`,
        })),
      ],
      action:
        `Establish the premium before you plan the conversion: what the agency rate is against the ` +
        `permanent equivalent, role by role, for the ${concentrated[0]?.key ?? "largest"} population ` +
        `first. Then convert the roles where the work is permanent and the premium is real — the ` +
        `${best?.play.name ?? "agency"} play models it against the roles Atlas can already see.`,
      playId: best?.play.id ?? null,
      playName: best?.play.name ?? null,
      prize:
        best && best.analysis.projectedSaving > 0
          ? {
              amount: best.analysis.projectedSaving,
              nature: "cost-rebase",
              statement:
                `${currency(best.analysis.projectedSaving)} a year across ` +
                `${best.analysis.candidates.length} role${best.analysis.candidates.length === 1 ? "" : "s"}. ` +
                `Headcount is unchanged — the same work is bought at a lower price. ${best.analysis.method}`,
            }
          : {
              amount: null,
              nature: "cost-rebase",
              statement:
                `Atlas cannot size this yet: converting agency to permanent only banks the premium ` +
                `between the two rates, and no rate for these positions reached the establishment. ` +
                `Supply agency spend, or a rate against any of these roles, and the play prices itself.`,
            },
      conditions: [
        `That 0 FTE means agency in your files — Atlas read it that way and states it on the ingest register.`,
        `That the work is permanent. Genuine surge cover converted to permanent is a cost increase, not a saving.`,
        best && best.analysis.guardrailNote ? best.analysis.guardrailNote : `No roles were excluded from this.`,
      ],
      strength: "observed",
      verdict: null,
      weight: best?.analysis.projectedSaving ?? metrics.contingentCount * 100,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* 5. structural shape                                                  */
/* ------------------------------------------------------------------ */

function structureShape(
  comparison: UnitComparison,
  metrics: DiagnosticMetrics,
  business: BusinessContext,
  findPlay: FindPlay
): Hypothesis[] {
  const out: Hypothesis[] = [];

  const layerTarget = business.targets.find((t) => t.measure === "layers" && t.amount !== null);
  const passThrough = findPlay("pass-through-layers");
  const deepChain = findPlay("deep-chain-compression");
  const best = [passThrough, deepChain]
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => b.analysis.candidates.length - a.analysis.candidates.length)[0];

  if (metrics.singleReportCount > 0 && best && best.analysis.candidates.length > 0) {
    const over = layerTarget?.amount != null ? metrics.layers - layerTarget.amount : null;
    out.push({
      id: "structure:pass-through",
      lens: "Spans and layers",
      unit: null,
      title: `${metrics.singleReportCount} manager${metrics.singleReportCount === 1 ? "" : "s"} in this structure ${metrics.singleReportCount === 1 ? "has" : "have"} exactly one direct report`,
      thinking:
        `A manager with one report is a layer that passes decisions through rather than making them. ` +
        `Each one adds a step to every approval that crosses it and a rung to the career ladder ` +
        `underneath it — which is often why it exists, and why removing it is a people conversation ` +
        `before it is a structural one. The structure carries ${metrics.layers} layers and an average ` +
        `span of ${metrics.averageSpan.toFixed(1)}.` +
        (over !== null && over > 0
          ? ` You said you are aiming for ${layerTarget!.amount} layers, so this sits ${over} above that.`
          : ""),
      signals: [
        { label: "Single-report managers", value: String(metrics.singleReportCount) },
        {
          label: "Layers",
          value: String(metrics.layers),
          comparison:
            layerTarget?.amount != null ? `your stated target is ${layerTarget.amount}` : undefined,
        },
        {
          label: "Average span",
          value: metrics.averageSpan.toFixed(1),
          comparison:
            comparison.medians.averageSpan !== null
              ? `median ${comparison.label.toLowerCase()} runs ${comparison.medians.averageSpan.toFixed(1)}`
              : undefined,
        },
        { label: "Thin spans", value: String(metrics.thinSpanCount) },
      ],
      action:
        `Test each of these against one question: what does this role decide that the level above it ` +
        `does not? Where the answer is nothing, the reports move up a level and the layer closes. ` +
        `Where the answer is a career step, keep the person and change the title rather than keeping ` +
        `the layer. The ${best.play.name} play lists the specific roles.`,
      playId: best.play.id,
      playName: best.play.name,
      prize: {
        amount: best.analysis.projectedSaving > 0 ? best.analysis.projectedSaving : null,
        nature: best.analysis.savingNature,
        statement:
          best.analysis.projectedSaving > 0
            ? `${currency(best.analysis.projectedSaving)} a year across ${best.analysis.candidates.length} ` +
              `role${best.analysis.candidates.length === 1 ? "" : "s"}, and one decision step out of every ` +
              `approval that crosses them. ${best.analysis.method}`
            : `Fewer steps in every approval that crosses these roles. Atlas has not priced it, because ` +
              `the roles involved carry no cost in your files.`,
      },
      conditions: [
        `That the single report is the whole team. A manager of one who also runs a large contractor or agency population is not a pass-through layer.`,
        best.analysis.guardrailNote ?? `No protected roles fell inside this.`,
      ],
      strength: "observed",
      verdict: null,
      weight: best.analysis.projectedSaving,
    });
  }

  const vacancy = findPlay("vacancy-rationalisation");
  if (metrics.vacantCount > 0 && vacancy && vacancy.analysis.candidates.length > 0) {
    out.push({
      id: "structure:vacancies",
      lens: "Workforce mix",
      unit: null,
      title: `${metrics.vacantCount} budgeted position${metrics.vacantCount === 1 ? " is" : "s are"} vacant`,
      thinking:
        `A vacancy that has been open long enough to appear in an establishment review is evidence ` +
        `about the role, not just about recruitment. Either the work is being absorbed elsewhere — in ` +
        `which case the establishment is carrying budget for work that is already being done — or it ` +
        `isn't, and something is being dropped that nobody has escalated.`,
      signals: [
        { label: "Vacant positions", value: String(metrics.vacantCount) },
        { label: "Filled", value: String(metrics.filledCount) },
      ],
      action:
        `For each vacancy, ask who is doing the work now. Where the answer is "the team absorbed it" ` +
        `and service has held, close the line and bank the budget. Where the answer is "nobody", the ` +
        `question is why the role has not been filled, and closing it would make a real gap permanent.`,
      playId: vacancy.play.id,
      playName: vacancy.play.name,
      prize: {
        amount: vacancy.analysis.projectedSaving > 0 ? vacancy.analysis.projectedSaving : null,
        nature: "cost-out",
        statement:
          vacancy.analysis.projectedSaving > 0
            ? `${currency(vacancy.analysis.projectedSaving)} a year in released budget across ` +
              `${vacancy.analysis.candidates.length} position${vacancy.analysis.candidates.length === 1 ? "" : "s"}. ${vacancy.analysis.method}`
            : `Released budget Atlas cannot size, because these positions carry no cost in your files.`,
      },
      conditions: [
        `That the vacancy is genuine and not a position held open deliberately for a known start date.`,
        `That the work has actually been absorbed. Closing a line whose work is simply not being done converts a service gap into a permanent one.`,
      ],
      strength: "observed",
      verdict: null,
      weight: vacancy.analysis.projectedSaving,
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* 6. testing what the client already believes                          */
/* ------------------------------------------------------------------ */

/**
 * The client's own hypothesis, put against the data.
 *
 * This is the part of the hypothesis layer that earns its name. Someone comes
 * into a restructure already believing something — that operations is
 * over-managed, that head office has grown, that one brand is carrying the
 * others. Repeating it back is worthless. Testing it is the whole job, and the
 * answer "the data does not support that" is at least as valuable as the
 * answer "it does", because it stops a redesign being built on it.
 *
 * Where Atlas genuinely cannot test a belief, it says so and says what would
 * let it. It never resolves a belief it cannot measure.
 */
function beliefTests(
  business: BusinessContext,
  comparison: UnitComparison,
  metrics: DiagnosticMetrics
): Hypothesis[] {
  return business.beliefs.map((belief, i) => test(belief, i, comparison, metrics));
}

function test(
  belief: Belief,
  index: number,
  comparison: UnitComparison,
  metrics: DiagnosticMetrics
): Hypothesis {
  const noun = comparison.label.toLowerCase();
  const unit = belief.unit
    ? comparison.units.find((u) => u.key.toLowerCase() === belief.unit!.toLowerCase()) ?? null
    : null;

  const base = {
    id: `belief:${index}`,
    lens: "Your hypothesis, tested",
    unit: belief.unit,
    title: `You said: "${belief.statedAs}"`,
    playId: null,
    playName: null,
    strength: "tested" as const,
    weight: 0,
  };

  const untestable = (why: string, needed: string): Hypothesis => ({
    ...base,
    thinking: why,
    signals: unit
      ? [
          { label: "Positions", value: String(unit.headcount) },
          { label: "Management share", value: pct(unit.managerShare) },
        ]
      : [],
    action: needed,
    prize: {
      amount: null,
      nature: "confidence",
      statement:
        "Settling this either way is worth more than the arithmetic — it decides whether the redesign is built on it.",
    },
    conditions: [needed],
    verdict: "untestable",
  });

  if (belief.unit && !unit) {
    return untestable(
      `Atlas could not find "${belief.unit}" among the ${noun}s in this establishment, so it has ` +
        `nothing to test this against.`,
      `Name the ${noun} as it appears in your files, or say which of these it maps to: ${comparison.units
        .slice(0, 8)
        .map((u) => u.key)
        .join(", ")}.`
    );
  }

  if (unit && !unit.comparable) {
    return untestable(
      `${unit.key} has ${unit.headcount} position${unit.headcount === 1 ? "" : "s"}, which is too few for ` +
        `its ratios to mean anything — one manager more or less would swing them entirely.`,
      `Nothing here can settle this. A ${noun} this size is a judgement call, not a measurement.`
    );
  }

  switch (belief.about) {
    case "management": {
      const median = comparison.medians.managerShare;
      if (!comparison.usable || median === null) {
        return untestable(
          `Testing a claim about management load needs the organisation split into comparable parts, ` +
            `and this establishment does not support that split: ${comparison.limitation}`,
          `Supply a function or cost-centre column covering the whole establishment and Atlas can test this directly.`
        );
      }
      // A median of zero is not a benchmark. It means most of the units in
      // this establishment carry no managers at all — usually because the
      // reporting lines inside them never reached Atlas — and every unit with
      // a single manager would clear it. Confirming a client's suspicion off
      // that would be the tool agreeing with whatever it was told.
      if (median <= 0) {
        const withManagers = comparison.comparableUnits.filter((u) => u.managers > 0).length;
        return untestable(
          `Atlas cannot test this against anything. ${comparison.comparableUnits.length - withManagers} of ` +
            `${comparison.comparableUnits.length} comparable ${noun}s carry no managers at all in the structure as ` +
            `it reached Atlas, so the median management share is zero — and against a median of zero, any ${noun} ` +
            `with a single manager would come back "over-managed". That would be Atlas agreeing with you rather ` +
            `than checking.`,
          `This usually means reporting lines are missing rather than that the organisation is flat. Supply a ` +
            `manager or reports-to column for the ${noun}s that show none, and this becomes measurable.`
        );
      }
      if (!unit) {
        return {
          ...base,
          thinking:
            `Across the whole organisation there are ${metrics.layers} layers, an average span of ` +
            `${metrics.averageSpan.toFixed(1)}, and ${metrics.thinSpanCount} manager${metrics.thinSpanCount === 1 ? "" : "s"} ` +
            `running a span below the healthy range. Whether that is "too much management" depends on ` +
            `which part of the business you mean — the spread between ${noun}s here runs from ` +
            `${pct(Math.min(...comparison.comparableUnits.map((u) => u.managerShare)))} to ` +
            `${pct(Math.max(...comparison.comparableUnits.map((u) => u.managerShare)))}.`,
          signals: comparison.comparableUnits.slice(0, 6).map((u) => ({
            label: u.key,
            value: `${pct(u.managerShare)} management`,
            comparison: `1 manager per ${(u.staffPerManager ?? 0).toFixed(1)} people`,
          })),
          action: `Name the ${noun} you had in mind and Atlas will test it against the group median of ${pct(median)}.`,
          prize: {
            amount: null,
            nature: "confidence",
            statement: `The organisation-wide answer is "it depends where" — which is the answer worth having before a group-wide management cut.`,
          },
          conditions: [comparison.choice],
          verdict: "untestable",
        };
      }

      const supported = above(unit.managerShare, median);
      const atMedian = Math.round(unit.headcount * median);
      const diff = unit.managers - atMedian;
      return {
        ...base,
        thinking: supported
          ? `The data supports it. ${unit.key} runs ${pct(unit.managerShare)} management against a group ` +
            `median of ${pct(median)} — one manager per ${(unit.staffPerManager ?? 0).toFixed(1)} people where the ` +
            `median ${noun} runs one per ${(comparison.medians.staffPerManager ?? 0).toFixed(1)}. That is ` +
            `${diff} more management role${Math.abs(diff) === 1 ? "" : "s"} than the same headcount would carry elsewhere in the group.`
          : `The data does not support it. ${unit.key} runs ${pct(unit.managerShare)} management against a ` +
            `group median of ${pct(median)} — one manager per ${(unit.staffPerManager ?? 0).toFixed(1)} people, ` +
            `${unit.managerShare <= median ? "at or below" : "within a quarter of"} the median ${noun}. ` +
            `If ${unit.key} feels over-managed, the cause is not the number of managers, and cutting them ` +
            `would take out capacity without touching whatever is actually producing the feeling.`,
        signals: [
          {
            label: `${unit.key} management share`,
            value: pct(unit.managerShare),
            comparison: `group median ${pct(median)}`,
          },
          {
            label: "People per manager",
            value: (unit.staffPerManager ?? 0).toFixed(1),
            comparison: `median ${(comparison.medians.staffPerManager ?? 0).toFixed(1)}`,
          },
          { label: "Average span inside the unit", value: unit.averageSpan.toFixed(1) },
          { label: "Layers inside the unit", value: String(unit.layers) },
        ],
        action: supported
          ? `Work the gap role by role rather than as a percentage — the management-load finding on this screen has the arithmetic and the play that models it.`
          : `Look at where the work is decided rather than at how many managers there are: layers, approval steps and span shape. The spans-and-layers findings on this screen are the better place to start.`,
        prize: {
          amount: null,
          nature: "confidence",
          statement: supported
            ? `A suspicion becomes a number you can put in a paper: ${diff} role${Math.abs(diff) === 1 ? "" : "s"} above the group's own median.`
            : `A redesign not built on a premise the data contradicts. That is the cheapest saving on this screen.`,
        },
        conditions: [
          comparison.choice,
          `A manager here is anyone with at least one direct report in the structure as it reached Atlas.`,
        ],
        verdict: supported ? "supported" : "not supported",
        weight: 0,
      };
    }

    case "productivity": {
      if (!unit || unit.revenuePerHead === null) {
        return untestable(
          `Atlas has no revenue attached to ${unit?.key ?? "this part of the business"}, and productivity ` +
            `cannot be measured from an establishment file. Cost per head can — but a ${noun} that costs ` +
            `less per head is not a ${noun} that produces more.`,
          `Add revenue for ${unit?.key ?? "each " + noun} in the business context and Atlas will test this against the group median.`
        );
      }
      const median = comparison.medians.revenuePerHead;
      if (median === null) {
        return untestable(
          `Only ${unit.key} carries a revenue figure, so there is nothing to compare it against.`,
          `Add revenue for at least one other ${noun}.`
        );
      }
      const supported = below(unit.revenuePerHead, median);
      return {
        ...base,
        thinking: supported
          ? `The data supports it. ${unit.key} earns ${currency(unit.revenuePerHead)} per head against a ` +
            `median of ${currency(median)} across the ${noun}s you have given revenue for.`
          : `The data does not support it. ${unit.key} earns ${currency(unit.revenuePerHead)} per head against a ` +
            `median of ${currency(median)} — ` +
            (unit.revenuePerHead >= median
              ? `at or above it.`
              : `below it, but not by enough to separate ${unit.key} from the middle of the group.`),
        signals: [
          { label: "Revenue per head", value: currency(unit.revenuePerHead), comparison: `median ${currency(median)}` },
          {
            label: "Labour as a share of revenue",
            value: unit.labourShareOfRevenue !== null ? pct(unit.labourShareOfRevenue) : "not priced",
          },
        ],
        action: supported
          ? `Separate mix from method before acting: what work sits in ${unit.key} that the stronger ${noun}s do not carry?`
          : `Whatever is driving the concern in ${unit.key}, it is not output per head. Cost per head and management load are the better tests, and both are on this screen.`,
        prize: {
          amount: null,
          nature: "confidence",
          statement: `Your figures, against your own establishment — the comparison a board will actually accept.`,
        },
        conditions: [`Revenue as you stated it. Atlas did not adjust it for period, mix or intercompany.`],
        verdict: supported ? "supported" : "not supported",
        weight: 0,
      };
    }

    case "workforce-mix": {
      if (!unit) {
        const supported = metrics.contingentCount > 0;
        return {
          ...base,
          thinking: supported
            ? `The data supports it at group level: ${metrics.contingentCount} of ${metrics.headcount} positions ` +
              `carry no contracted FTE and are read as agency.`
            : `The data does not support it: every position in this establishment carries contracted FTE.`,
          signals: [
            { label: "Agency positions", value: String(metrics.contingentCount) },
            { label: "Vacant", value: String(metrics.vacantCount) },
            { label: "Contracted FTE", value: metrics.totalFte.toFixed(0) },
          ],
          action: supported
            ? `The workforce-mix finding on this screen has where it concentrates and what converting it is worth.`
            : `Nothing to act on here.`,
          prize: { amount: null, nature: "confidence", statement: `Settled from the establishment itself.` },
          conditions: [`That 0 FTE means agency in your files.`],
          verdict: supported ? "supported" : "not supported",
          weight: 0,
        };
      }
      const shares = comparison.comparableUnits.map((u) => u.agencyShare);
      const median = shares.length > 0 ? shares.sort((a, b) => a - b)[Math.floor(shares.length / 2)] : 0;
      // A floor, because a median of zero would make one agency worker an outlier.
      const supported = above(unit.agencyShare, median, 0.05);
      return {
        ...base,
        thinking: supported
          ? `The data supports it. ${unit.key} runs ${pct(unit.agencyShare)} agency (${unit.agency} of ` +
            `${unit.headcount} positions) against a median ${noun} at ${pct(median)}.`
          : `The data does not support it. ${unit.key} runs ${pct(unit.agencyShare)} agency against a median ` +
            `${noun} at ${pct(median)} — it is not the outlier.`,
        signals: [
          { label: `${unit.key} agency share`, value: pct(unit.agencyShare), comparison: `median ${pct(median)}` },
          { label: "Vacant in this unit", value: String(unit.vacant) },
        ],
        action: supported
          ? `Establish the premium on those ${unit.agency} positions before planning a conversion.`
          : `If agency spend is the concern, it is a group-level pattern rather than a ${unit.key} one.`,
        prize: { amount: null, nature: "confidence", statement: `Locates the problem before the redesign does.` },
        conditions: [`That 0 FTE means agency in your files.`],
        verdict: supported ? "supported" : "not supported",
        weight: 0,
      };
    }

    case "cost": {
      if (!unit || unit.costPerFte === null || comparison.medians.costPerFte === null) {
        return untestable(
          `Atlas cannot test this: ${unit ? `${unit.pricedCount} of ${unit.key}'s ${unit.headcount} positions carry a cost` : "no unit was named"}.`,
          `Close the cost gaps flagged on the ingest register and this becomes measurable.`
        );
      }
      const median = comparison.medians.costPerFte;
      const supported = above(unit.costPerFte, median);
      return {
        ...base,
        thinking: supported
          ? `The data supports it. ${unit.key} costs ${currency(unit.costPerFte)} per FTE against a median ` +
            `${noun} at ${currency(median)}, and takes ${pct(unit.costShare)} of total cost with ` +
            `${pct(unit.headcountShare)} of the people.`
          : `The data does not support it. ${unit.key} costs ${currency(unit.costPerFte)} per FTE against a ` +
            `median ${noun} at ${currency(median)} — it is not the expensive one.`,
        signals: [
          { label: "Cost per FTE", value: currency(unit.costPerFte), comparison: `median ${currency(median)}` },
          { label: "Share of cost", value: pct(unit.costShare), comparison: `${pct(unit.headcountShare)} of people` },
          { label: "Priced positions", value: `${unit.pricedCount} of ${unit.headcount}` },
        ],
        action: supported
          ? `Split it into seniority and rate: the cost-concentration finding on this screen has the arithmetic.`
          : `The cost concern is somewhere else. Rank the ${noun}s by cost per FTE on this screen and start at the top.`,
        prize: { amount: null, nature: "confidence", statement: `Points the review at the right ${noun}.` },
        conditions: [
          unit.pricedCount < unit.headcount
            ? `Computed over the ${unit.pricedCount} priced positions in ${unit.key}, not all ${unit.headcount}.`
            : `Every position in ${unit.key} carries a cost.`,
        ],
        verdict: supported ? "supported" : "not supported",
        weight: 0,
      };
    }

    case "structure": {
      const median = comparison.medians.layers;
      if (!unit || median === null) {
        return {
          ...base,
          thinking:
            `At group level the structure runs ${metrics.layers} layers with an average span of ` +
            `${metrics.averageSpan.toFixed(1)}, ${metrics.thinSpanCount} span${metrics.thinSpanCount === 1 ? "" : "s"} ` +
            `below the healthy range and ${metrics.wideSpanCount} above it.`,
          signals: [
            { label: "Layers", value: String(metrics.layers) },
            { label: "Average span", value: metrics.averageSpan.toFixed(1) },
            { label: "Thin spans", value: String(metrics.thinSpanCount) },
            { label: "Wide spans", value: String(metrics.wideSpanCount) },
          ],
          action: `Name the ${noun} you mean and Atlas will compare its depth and span against the rest of the group.`,
          prize: { amount: null, nature: "confidence", statement: `The shape, stated rather than felt.` },
          conditions: [comparison.choice],
          verdict: "untestable",
        };
      }
      const supported = unit.layers > median;
      return {
        ...base,
        thinking: supported
          ? `The data supports it. ${unit.key} runs ${unit.layers} layers against a median ${noun} at ` +
            `${median.toFixed(0)}, on an average span of ${unit.averageSpan.toFixed(1)}.`
          : `The data does not support it. ${unit.key} runs ${unit.layers} layers against a median ${noun} at ` +
            `${median.toFixed(0)} — it is not deeper than the rest of the group.`,
        signals: [
          { label: "Layers in this unit", value: String(unit.layers), comparison: `median ${median.toFixed(0)}` },
          { label: "Average span", value: unit.averageSpan.toFixed(1) },
        ],
        action: supported
          ? `The spans-and-layers findings on this screen list the specific roles a compression would touch.`
          : `Depth is not the issue in ${unit.key}. Management share and cost per FTE are the next two tests.`,
        prize: { amount: null, nature: "confidence", statement: `Depth measured rather than assumed.` },
        conditions: [`Depth is measured within the unit, from its own top role down.`],
        verdict: supported ? "supported" : "not supported",
        weight: 0,
      };
    }

    default:
      return untestable(
        `Atlas has recorded this but has no measure in the establishment that would settle it.`,
        `Rephrase it as a claim about management load, cost, workforce mix, structure or revenue per head, and Atlas will test it against the group's own median.`
      );
  }
}

/* ------------------------------------------------------------------ */
/* 7. the client's target, against what has actually been found         */
/* ------------------------------------------------------------------ */

function targetGap(
  business: BusinessContext,
  plays: { play: PlayMeta; analysis: PlayAnalysis }[]
): Hypothesis[] {
  const target = business.targets.find((t) => t.measure === "cost" && t.amount !== null);
  if (!target?.amount) return [];

  const live = plays.filter((p) => p.analysis.candidates.length > 0);
  if (live.length === 0) return [];

  const largest = [...live].sort((a, b) => b.analysis.projectedSaving - a.analysis.projectedSaving)[0];

  // Plays overlap by design — the same thin-span manager appears in several —
  // so they must never be added up. The largest single play is the only
  // defensible headline, and the rest are alternatives to it.
  const covered = largest.analysis.projectedSaving;
  const gap = target.amount - covered;

  return [
    {
      id: "target:cost",
      lens: "Against your target",
      unit: null,
      title:
        gap > 0
          ? `Your target is ${currency(target.amount)}; the largest single play Atlas can evidence is ${currency(covered)}`
          : `Your target of ${currency(target.amount)} is covered by a single play Atlas can evidence`,
      thinking:
        `You said: "${target.statedAs}". Atlas has found ${live.length} play${live.length === 1 ? "" : "s"} with ` +
        `candidates in this establishment, the largest worth ${currency(covered)} (${largest.play.name}). ` +
        `Those plays deliberately overlap — the same manager appears in several — so they cannot be added ` +
        `together, which is why the comparison is against the largest and not against a total. ` +
        (gap > 0
          ? `That leaves ${currency(gap)} of your target unevidenced by structure alone. A gap that size is ` +
            `not usually closed by finding more roles; it is closed by the levers that are not in an ` +
            `establishment file — supplier spend, property, systems, or scope.`
          : `The structural levers alone reach it, which means the redesign does not need to touch service delivery to get there.`),
      signals: [
        { label: "Your target", value: currency(target.amount), comparison: target.horizon ?? undefined },
        { label: "Largest single evidenced play", value: currency(covered), comparison: largest.play.name },
        { label: "Plays with candidates", value: `${live.length} of ${plays.length}` },
        ...(gap > 0 ? [{ label: "Unevidenced by structure", value: currency(gap) }] : []),
      ],
      action:
        gap > 0
          ? `Model the largest two or three plays as alternatives and pick on risk rather than on size, ` +
            `then take the remaining ${currency(gap)} to the non-people cost base before assuming more roles have to go.`
          : `Model ${largest.play.name} first and hold the others in reserve — you do not need all of them.`,
      playId: largest.play.id,
      playName: largest.play.name,
      prize: {
        amount: covered,
        nature: largest.analysis.savingNature,
        statement:
          `${currency(covered)} a year from ${largest.play.name}, across ${largest.analysis.candidates.length} ` +
          `role${largest.analysis.candidates.length === 1 ? "" : "s"}. ${largest.analysis.method}`,
      },
      conditions: [
        `Plays overlap and must not be summed. This compares your target against the largest single one, not against a total.`,
        `Every figure here is of the positions that carry a cost in your files.`,
      ],
      strength: "tested",
      verdict: null,
      weight: covered,
    },
  ];
}

/* ------------------------------------------------------------------ */

/** What Atlas would be able to say that it currently can't, and what it needs. */
function wouldUnlock(
  analysis: FunctionAnalysis,
  business: BusinessContext,
  metrics: DiagnosticMetrics
): string[] {
  const { primary: comparison } = analysis;
  const out: string[] = [];
  const noun = comparison.label.toLowerCase();

  // The most consequential gap, and the least obvious one. A median management
  // share of zero doesn't mean a flat organisation — it means the reporting
  // lines inside most units never arrived, and it silently disables every
  // comparison on this page that depends on who reports to whom.
  const flat = comparison.comparableUnits.filter((u) => u.managers === 0);
  if ((comparison.medians.managerShare ?? 0) <= 0 && comparison.comparableUnits.length > 0) {
    out.push(
      `Reporting lines inside ${flat.length} of ${comparison.comparableUnits.length} ${noun}s — Atlas sees no ` +
        `manager at all in ${flat
          .slice(0, 4)
          .map((u) => u.key)
          .join(", ")}${flat.length > 4 ? " and others" : ""}, so the median management share is zero and no ` +
        `${noun} can be compared on management load. A manager or reports-to column for those ${noun}s turns ` +
        `"which function is bloated" from unanswerable into a number.`
    );
  }

  if (comparison.dimension === "division") {
    const byFunction = analysis.all.find((c) => c.dimension === "function");
    out.push(
      `A function or cost-centre column covering the whole establishment — Atlas is comparing by division ` +
        `because the department column reached only ${pct(byFunction?.coverage ?? 0)} of positions ` +
        `(${(byFunction?.unclassified ?? 0).toLocaleString()} carry no department at all). With it, ` +
        `"which function is bloated" is answered about Finance and Operations rather than about whichever ` +
        `branch of the chart a position happens to hang from.`
    );
  }
  if (business.revenue.filter((r) => r.unit !== null).length < 2) {
    out.push(
      `Revenue by ${noun} — one line each. Unlocks revenue per head, revenue per FTE and labour as a share ` +
        `of revenue, ranked against your own median.`
    );
  }
  if (business.targets.length === 0) {
    out.push(
      `What you are trying to reach, and by when. Atlas will measure every play against it rather than ` +
        `presenting ten options of unstated relevance.`
    );
  }
  if (business.beliefs.length === 0) {
    out.push(
      `What you already suspect. Atlas tests each one against the establishment and tells you plainly when ` +
        `the data does not support it — which is the finding that saves the most money.`
    );
  }
  if (totalRevenue(business) === null && metrics.totalCost > 0) {
    out.push(
      `Group revenue — even one figure. Puts the ${currency(metrics.totalCost)} labour cost on this ` +
        `establishment into a ratio rather than leaving it as a number.`
    );
  }

  return out;
}
