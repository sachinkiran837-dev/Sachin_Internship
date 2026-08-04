import nesConfig from "@/config/nes-transition-cost.json";
import awardConfig from "@/config/award-coverage.json";
import churnConfig from "@/config/churn-budget.json";
import { daysSince } from "@/lib/ingest/parseDate";
import type { Position } from "@/lib/graph/types";

/**
 * e3-ir-eba-overlay: Australian industrial reality held against every
 * scenario — award/EBA coverage, transition cost, consultation obligations,
 * change-fatigue budget — and the standing caveat attached to any dollar
 * figure this module produces.
 *
 * Transition cost uses the Fair Work Act's National Employment Standards as
 * a federal floor (real, citable, the same for every workforce regardless of
 * which award or EBA actually covers it). Award/EBA-specific enhancements
 * and long service leave both need engagement-specific data this build
 * doesn't have, so both read as an explicit gap rather than an invented
 * figure — the same discipline C4 applies to activity data.
 */

export const STANDING_CAVEAT =
  "indicative net change, subject to EBA consultation, redeployment obligations and safe-staffing checks; not a cashable saving until confirmed.";

interface TenureBand {
  underYears: number | null;
  weeks: number;
}

function weeksFor(tenureYears: number, table: TenureBand[]): number {
  for (const band of table) {
    if (band.underYears === null || tenureYears < band.underYears) return band.weeks;
  }
  return table[table.length - 1]?.weeks ?? 0;
}

export interface AwardCoverageReading {
  grade: string;
  headcount: number;
  mapped: boolean;
  instrument: string | null;
}

/** E3 step 1: award/EBA coverage by classification — unmapped unless the engagement has supplied real coverage data. */
export function mapAwardCoverage(positions: Position[]): AwardCoverageReading[] {
  const coverage = (awardConfig.coverageByGrade ?? {}) as Record<string, string>;
  const counts = new Map<string, number>();
  for (const p of positions) {
    const key = p.grade?.trim() || "(no grade recorded)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([grade, headcount]) => ({
      grade,
      headcount,
      mapped: Boolean(coverage[grade]),
      instrument: coverage[grade] ?? null,
    }))
    .sort((a, b) => b.headcount - a.headcount);
}

export interface TransitionCostReading {
  positionId: string;
  title: string;
  tenureYears: number | null;
  noticeWeeks: number;
  redundancyWeeks: number;
  weeklyRate: number;
  transitionCost: number;
  lslComputable: false;
  basis: string;
}

/** E3 step 2: NES-minimum notice + redundancy pay for one position. Never omitted — a role with no tenure data still gets the under-1-year floor stated as such. */
export function computeTransitionCost(position: Pick<Position, "id" | "title" | "cost" | "startDate">): TransitionCostReading {
  const ageDays = daysSince(position.startDate);
  const tenureYears = ageDays !== null ? ageDays / 365.25 : 0;
  const noticeWeeks = weeksFor(tenureYears, nesConfig.noticeWeeksByTenure);
  const redundancyWeeks = weeksFor(tenureYears, nesConfig.redundancyWeeksByTenure);
  const weeklyRate = position.cost / 52;
  const transitionCost = (noticeWeeks + redundancyWeeks) * weeklyRate;

  return {
    positionId: position.id,
    title: position.title,
    tenureYears: position.startDate ? tenureYears : null,
    noticeWeeks,
    redundancyWeeks,
    weeklyRate,
    transitionCost,
    lslComputable: false,
    basis: position.startDate
      ? `${nesConfig.instrument}, at ${tenureYears.toFixed(1)} years' tenure. Long service leave is not included — it is state-based, not federal, and needs the jurisdiction confirmed.`
      : `${nesConfig.instrument}, at the under-1-year floor — no start date reached this position, so tenure could not be read and the minimum is shown rather than assumed.`,
  };
}

export interface ScenarioIrReading {
  churn: number;
  headcount: number;
  churnRate: number;
  churnBudgetShare: number;
  overChurnBudget: boolean;
  consultationRequired: boolean;
  consultationNote: string | null;
  totalTransitionCost: number;
  standingCaveat: string;
}

/** E3 steps 3-5: consultation trigger, churn-vs-budget, and the transition cost of every role a scenario proposes to remove. */
export function computeScenarioIrReading(
  baseline: Position[],
  scenario: Position[],
  removedPositions: Pick<Position, "id" | "title" | "cost" | "startDate">[]
): ScenarioIrReading {
  const scenarioById = new Map(scenario.map((p) => [p.id, p] as const));
  const churn = baseline.filter((p) => {
    const stillPresent = scenarioById.get(p.id);
    return !stillPresent || stillPresent.managerId !== p.managerId;
  }).length;

  const churnRate = baseline.length === 0 ? 0 : churn / baseline.length;
  const overChurnBudget = churnRate > churnConfig.churnBudgetShare;

  const totalTransitionCost = removedPositions.reduce(
    (s, p) => s + computeTransitionCost(p).transitionCost,
    0
  );

  return {
    churn,
    headcount: baseline.length,
    churnRate,
    churnBudgetShare: churnConfig.churnBudgetShare,
    overChurnBudget,
    consultationRequired: removedPositions.length > 0,
    consultationNote:
      removedPositions.length > 0
        ? "Major-change consultation obligations likely apply — an employer proposing a change with significant effects on employees must consult under the applicable award, agreement or the Fair Work Act's model consultation term, and redeployment-first obligations apply before any removal is finalised."
        : null,
    totalTransitionCost,
    standingCaveat: STANDING_CAVEAT,
  };
}

export const IR_EBA_METHOD =
  `Transition cost is the ${nesConfig.instrument} floor only — an award or EBA's own terms can exceed it, and long ` +
  `service leave is never included because it is state-based, not federal. Consultation and churn-budget checks are ` +
  `independent signals, per the skill's own rule that neither should suppress the other. The standing caveat is fixed ` +
  `text, never model-drafted, so the legal language stays exact: "${STANDING_CAVEAT}"`;
