import { computeMetrics } from "@/lib/metrics/diagnostics";
import { computeScenarioIrReading } from "@/lib/analysis/irEbaOverlay";
import { buildKeyPersonRisk, keyPersonRolesTouched } from "@/lib/analysis/keyPersonRisk";
import { tagNodes } from "@/lib/graph/tagging";
import type { Position } from "@/lib/graph/types";

/**
 * Deliberately not imported from `lib/scenario/compare.ts`, even though that
 * module already has an identical `allTouchedIds` — `compare.ts` pulls in
 * `db/repo.ts` at module scope for `getBaselineRootId`, and `db/client.ts`
 * throws eagerly on import when `DATABASE_URL` is unset. Every other
 * analysis module in this codebase (peerBenchmark, contingentReliance, ...)
 * is deliberately DB-free so it can run in memory and in a verify script
 * with no database — importing from `compare.ts` here would have quietly
 * broken that for every consumer of this module too. Caught by running this
 * module's own verify script with no database configured.
 */
function allTouchedIds(baseline: Position[], scenario: Position[]): Set<string> {
  const scenarioById = new Map(scenario.map((p) => [p.id, p] as const));
  const touched = new Set<string>();
  for (const p of baseline) {
    const stillPresent = scenarioById.get(p.id);
    if (!stillPresent || stillPresent.managerId !== p.managerId) touched.add(p.id);
  }
  return touched;
}

/**
 * h2-scenario-impact-modeling: the complete downstream impact of one
 * scenario's change set against the locked baseline — structural,
 * financial, governance — so scenarios can be compared side by side rather
 * than argued over one figure at a time.
 *
 * "Branch, never mutate" (step 1) is already structural in this codebase,
 * not a discipline this module has to enforce: a scenario's positions live
 * in their own `scenarios.working_graph_json` row, and nothing anywhere
 * writes to the baseline `positions` table from a scenario mutation
 * (`lib/scenario/mutate.ts` re-reads `getBaselinePositions` fresh on every
 * call). This module reads both position sets and never mutates either.
 */

export interface StructuralImpact {
  headcountDelta: number;
  layersDelta: number;
  averageSpanDelta: number;
  rolesRemoved: number;
}

export interface FinancialImpact {
  costRemovedGross: number;
  transitionCost: number;
  netAtRunRate: number;
  breakEvenMonths: number | null;
  /** Cumulative net position (negative until break-even) at each month, 0-24. */
  phasedCurve: { month: number; cumulativeNet: number }[];
  /** This module's own figures are always fully computed from real position costs — the "estimated"/"requires-data" distinction is a per-play concept, see g2-value-sizing's reconciled stack for that breakdown. */
  estimateClass: "computed";
  valueType: "cashable";
  standingCaveat: string;
}

export interface GovernanceImpact {
  reportingLineChurn: number;
  churnRate: number;
  overChurnBudget: boolean;
  keyPersonTouched: number;
  protectedRolesHeld: number;
  protectedRolesTotal: number;
  /** True only when protectedRolesHeld === protectedRolesTotal — H2's own rule: "50 of 51" is not 97% compliant, it is blocked. Held here as a fact to display, not a gate — the real gate is the mutation guardrail itself. */
  allProtectedRolesHeld: boolean;
}

export interface ScenarioImpact {
  scenarioId: string;
  name: string;
  structural: StructuralImpact;
  financial: FinancialImpact;
  governance: GovernanceImpact;
}

export function computeScenarioImpact(
  baseline: Position[],
  scenarioId: string,
  scenarioName: string,
  scenario: Position[],
  rootId: string | null
): ScenarioImpact {
  const baselineMetrics = computeMetrics(baseline, rootId);
  const scenarioRootId = scenario.find((p) => p.managerId === null)?.id ?? rootId;
  const scenarioMetrics = computeMetrics(scenario, scenarioRootId);

  const scenarioIds = new Set(scenario.map((p) => p.id));
  const removedPositions = baseline.filter((p) => !scenarioIds.has(p.id) && !p.synthetic);

  const structural: StructuralImpact = {
    headcountDelta: scenarioMetrics.headcount - baselineMetrics.headcount,
    layersDelta: scenarioMetrics.layers - baselineMetrics.layers,
    averageSpanDelta: scenarioMetrics.averageSpan - baselineMetrics.averageSpan,
    rolesRemoved: removedPositions.length,
  };

  const ir = computeScenarioIrReading(baseline, scenario, removedPositions);
  const costRemovedGross = baselineMetrics.totalCost - scenarioMetrics.totalCost;
  // The run-rate figure is the ongoing annual saving once the change has landed — transition cost is a one-off,
  // netted into the phased curve and break-even month below, not into this steady-state number itself.
  const netAtRunRate = costRemovedGross;
  const monthlyNet = netAtRunRate / 12;
  const breakEvenMonths = netAtRunRate > 0 ? ir.totalTransitionCost / monthlyNet : null;

  const phasedCurve = Array.from({ length: 25 }, (_, month) => ({
    month,
    cumulativeNet: monthlyNet * month - ir.totalTransitionCost,
  }));

  const financial: FinancialImpact = {
    costRemovedGross,
    transitionCost: ir.totalTransitionCost,
    netAtRunRate,
    breakEvenMonths,
    phasedCurve,
    estimateClass: "computed",
    valueType: "cashable",
    standingCaveat: ir.standingCaveat,
  };

  const touched = allTouchedIds(baseline, scenario);
  const keyPersonFlags = buildKeyPersonRisk(baseline, rootId).flagged;

  // "Held" means still present — not removed and not itself reassigned by a
  // deliberate move. Its managerId legitimately shifts when its OWN manager
  // is delayered (the report moves to the grandparent, same as any other
  // role caught under a removed manager); `checkProtected` never blocked
  // that, because it only ever checks the position being removed or
  // reassigned, not its descendants — so that shift is not a guardrail
  // violation and must not read as the role having been let go. Only a
  // protected role missing entirely, or one whose manager changed for a
  // reason other than its own manager's removal, is a real finding.
  //
  // Read via `tagNodes`, the same source `metrics.protectedCount` itself
  // uses — a raw `matchProtectedRole(title)` scan would miss every role held
  // only by E1's roster auto-hold (a manager protected via `isUnitRoster`,
  // never a title match at all), undercounting "held" against a total that
  // correctly includes them and manufacturing a false gap.
  const protectedBaseline = tagNodes(baseline, rootId).filter((n) => !n.synthetic && n.flags.protected);
  const scenarioById = new Map(scenario.map((p) => [p.id, p] as const));
  const baselineById = new Map(baseline.map((p) => [p.id, p] as const));
  const protectedRolesHeld = protectedBaseline.filter((p) => {
    const still = scenarioById.get(p.id);
    if (!still) return false;
    if (still.managerId === p.managerId) return true;
    // Manager changed — legitimate only if the original manager is the one that's gone (delayering side-effect).
    return p.managerId !== null && !scenarioById.has(p.managerId) && baselineById.has(p.managerId);
  }).length;

  const governance: GovernanceImpact = {
    reportingLineChurn: ir.churn,
    churnRate: ir.churnRate,
    overChurnBudget: ir.overChurnBudget,
    keyPersonTouched: keyPersonRolesTouched(keyPersonFlags, touched),
    protectedRolesHeld,
    protectedRolesTotal: baselineMetrics.protectedCount,
    allProtectedRolesHeld: protectedRolesHeld === baselineMetrics.protectedCount,
  };

  return { scenarioId, name: scenarioName, structural, financial, governance };
}

export type ComparisonRow = "headcountDelta" | "netAtRunRate" | "breakEvenMonths" | "reportingLineChurn";

/**
 * H2 step 6: presented side by side, best value per row highlighted — never
 * collapsed to a single ranked winner. "Best" is row-specific (most negative
 * headcount delta is the deepest cut, highest net-at-run-rate is the most
 * money, lowest break-even is the fastest payback, lowest churn is the
 * least disruption) — a scenario can win some rows and lose others, which
 * is the trade-off this presentation exists to keep visible.
 */
export function highlightBestPerRow(impacts: ScenarioImpact[]): Partial<Record<ComparisonRow, string>> {
  if (impacts.length === 0) return {};
  const best: Partial<Record<ComparisonRow, string>> = {};

  best.headcountDelta = [...impacts].sort((a, b) => a.structural.headcountDelta - b.structural.headcountDelta)[0].scenarioId;
  best.netAtRunRate = [...impacts].sort((a, b) => b.financial.netAtRunRate - a.financial.netAtRunRate)[0].scenarioId;

  const withBreakEven = impacts.filter((i) => i.financial.breakEvenMonths !== null);
  if (withBreakEven.length > 0) {
    best.breakEvenMonths = [...withBreakEven].sort((a, b) => a.financial.breakEvenMonths! - b.financial.breakEvenMonths!)[0].scenarioId;
  }

  best.reportingLineChurn = [...impacts].sort((a, b) => a.governance.reportingLineChurn - b.governance.reportingLineChurn)[0].scenarioId;

  return best;
}

export const H2_METHOD =
  "Every scenario is costed as a named branch off the locked baseline, never the baseline itself — nothing this module " +
  "reads or writes can mutate it. Protected-roles-held is checked against the full register (`baselineMetrics.protectedCount`), " +
  "never just the roles a scenario happened to touch: holding 50 of 51 reads as 50 of 51, not 98%. Every dollar figure is " +
  "net of NES transition cost with a break-even month alongside it, and side-by-side comparison highlights the best value " +
  "per row rather than collapsing several scenarios to one ranked winner.";
