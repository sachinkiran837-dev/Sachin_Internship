import { tagNodes } from "@/lib/graph/tagging";
import type {
  DiagnosticMetrics,
  FlaggedPattern,
  LayoutNode,
  MetricsDelta,
  Position,
  ProtectedTier,
} from "@/lib/graph/types";

/**
 * The deterministic diagnostic engine (PRD C3): spans, layers, cost, and
 * inefficiency patterns. Not its own named skill file, but required shared
 * infrastructure that both scenario delta computation (C5) and findings
 * synthesis (C3's narrative layer) depend on — built once here.
 */
export function computeMetrics(positions: Position[], rootId: string | null): DiagnosticMetrics {
  const tagged = tagNodes(positions, rootId);

  // A consolidated establishment carries heading nodes — "Northern Brand",
  // and the node those brands sit under. They exist so the map is one tree
  // rather than several. They are not jobs: counting them would inflate
  // headcount, and reading their children as a span of control would invent
  // a manager with four reports who does not exist. Everything measured here
  // is measured over real positions only.
  const nodes = tagged.filter((n) => !n.synthetic);
  const managers = nodes.filter((n) => n.childIds.length > 0);

  const protectedByTier: Record<ProtectedTier, number> = {
    statutory: 0,
    governance: 0,
    safety: 0,
  };
  for (const n of nodes) {
    if (n.flags.protected) protectedByTier[n.flags.protected.tier] += 1;
  }

  const depths = nodes.map((n) => n.depth);

  return {
    headcount: nodes.length,
    filledCount: nodes.filter((n) => n.status === "filled").length,
    vacantCount: nodes.filter((n) => n.status === "vacant").length,
    contingentCount: nodes.filter((n) => n.status === "contingent").length,
    totalCost: nodes.reduce((sum, n) => sum + n.cost * n.fte, 0),
    // Depth is measured from the top of the real structure, so the heading
    // nodes above it don't read as an extra management layer.
    layers: nodes.length === 0 ? 0 : Math.max(...depths) - Math.min(...depths) + 1,
    averageSpan:
      managers.length === 0
        ? 0
        : managers.reduce((sum, n) => sum + n.childIds.length, 0) / managers.length,
    thinSpanCount: nodes.filter((n) => n.flags.spanHealth === "thin" && n.childIds.length > 0)
      .length,
    wideSpanCount: nodes.filter((n) => n.flags.spanHealth === "wide").length,
    singleReportCount: nodes.filter((n) => n.flags.singleReport).length,
    protectedCount: nodes.filter((n) => n.flags.protected).length,
    protectedByTier,
    flaggedPatterns: buildFlaggedPatterns(nodes),
  };
}

function buildFlaggedPatterns(nodes: LayoutNode[]): FlaggedPattern[] {
  const patterns: FlaggedPattern[] = [];

  const thin = nodes.filter((n) => n.flags.spanHealth === "thin" && n.childIds.length > 0);
  if (thin.length > 0) {
    patterns.push({
      id: "thin-spans",
      label: "Thin spans of control",
      detail: `${thin.length} manager${thin.length === 1 ? "" : "s"} with fewer direct reports than the healthy range — a flattening or consolidation candidate.`,
      positionIds: thin.map((n) => n.id),
    });
  }

  const wide = nodes.filter((n) => n.flags.spanHealth === "wide");
  if (wide.length > 0) {
    patterns.push({
      id: "wide-spans",
      label: "Wide spans of control",
      detail: `${wide.length} manager${wide.length === 1 ? "" : "s"} with more direct reports than the healthy range — a support or delayering risk.`,
      positionIds: wide.map((n) => n.id),
    });
  }

  const singleReportChains = nodes.filter((n) => n.flags.singleReport);
  if (singleReportChains.length > 0) {
    patterns.push({
      id: "single-report-chains",
      label: "Single-report reporting lines",
      detail: `${singleReportChains.length} manager${singleReportChains.length === 1 ? "" : "s"} with exactly one direct report — a likely delayering candidate.`,
      positionIds: singleReportChains.map((n) => n.id),
    });
  }

  const vacantWithTeam = nodes.filter((n) => n.flags.vacant && n.childIds.length > 0);
  if (vacantWithTeam.length > 0) {
    patterns.push({
      id: "vacant-manager",
      label: "Vacant roles with a live team",
      detail: `${vacantWithTeam.length} vacant manager position${vacantWithTeam.length === 1 ? "" : "s"} still carrying direct reports.`,
      positionIds: vacantWithTeam.map((n) => n.id),
    });
  }

  return patterns;
}

export function computeDelta(
  baseline: DiagnosticMetrics,
  scenario: DiagnosticMetrics,
  breachedPositionIds: string[]
): MetricsDelta {
  return {
    headcountDelta: scenario.headcount - baseline.headcount,
    costDelta: scenario.totalCost - baseline.totalCost,
    layersDelta: scenario.layers - baseline.layers,
    averageSpanDelta: scenario.averageSpan - baseline.averageSpan,
    safeStaffingBreach: breachedPositionIds.length > 0,
    breachedPositionIds,
  };
}
