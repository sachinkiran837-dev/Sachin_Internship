import { computeDelta, computeMetrics } from "@/lib/metrics/diagnostics";
import { matchProtectedRole } from "@/lib/protected-roles/match";
import { getBaselineRootId } from "@/db/repo";
import type { DiagnosticMetrics, MetricsDelta, Position } from "@/lib/graph/types";

/**
 * Protected-tier removal/reassignment is already blocked at the mutation
 * entry point, but a clinical role (a classification tag, not a protected
 * rule) isn't automatically guarded — so this flag is the visible net for
 * "any protected or clinical role was touched", per the scenario spec.
 */
export function findSafeStaffingBreaches(baseline: Position[], scenario: Position[]): string[] {
  const scenarioById = new Map(scenario.map((p) => [p.id, p] as const));
  const touched: string[] = [];

  for (const p of baseline) {
    const isSensitive = Boolean(matchProtectedRole(p.title)) || p.clinicalFlag;
    if (!isSensitive) continue;

    const stillPresent = scenarioById.get(p.id);
    if (!stillPresent || stillPresent.managerId !== p.managerId) {
      touched.push(p.id);
    }
  }

  return touched;
}

export interface ScenarioComparison {
  scenarioId: string;
  name: string;
  metrics: DiagnosticMetrics;
  delta: MetricsDelta;
}

export function compareScenarios(
  baselinePositions: Position[],
  scenarios: { id: string; name: string; positions: Position[] }[]
): { baselineMetrics: DiagnosticMetrics; comparisons: ScenarioComparison[] } {
  const rootId = getBaselineRootId(baselinePositions);
  const baselineMetrics = computeMetrics(baselinePositions, rootId);

  const comparisons = scenarios.map((s) => {
    const scenarioRootId = getBaselineRootId(s.positions) ?? rootId;
    const metrics = computeMetrics(s.positions, scenarioRootId);
    const breaches = findSafeStaffingBreaches(baselinePositions, s.positions);
    return {
      scenarioId: s.id,
      name: s.name,
      metrics,
      delta: computeDelta(baselineMetrics, metrics, breaches),
    };
  });

  return { baselineMetrics, comparisons };
}
