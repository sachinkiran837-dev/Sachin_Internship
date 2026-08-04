import { tagNodes } from "@/lib/graph/tagging";
import { classifyShape } from "@/lib/analysis/shape";
import { computeHygiene } from "@/lib/analysis/hygiene";
import { totalFullyLoadedCost } from "@/lib/cost/onCosts";
import { estimateUnpriced } from "@/lib/cost/estimate";
import { listArchetypes } from "@/lib/graph/spanArchetype";
import { divisionOf } from "@/lib/analysis/functions";
import { findControlGaps } from "@/lib/protected-roles/match";
import layerBandConfig from "@/config/layer-bands.json";
import type {
  DiagnosticMetrics,
  FlaggedPattern,
  IngestIssue,
  LayerBandVerdict,
  LayoutNode,
  MetricsDelta,
  Position,
  ProtectedTier,
  SingleReportConcentration,
  SpanArchetypeBreakdown,
} from "@/lib/graph/types";

interface LayerBandConfig {
  healthyMin: number;
  healthyMax: number;
  flagAbove: number;
}
const LAYER_BAND: LayerBandConfig = layerBandConfig;

/**
 * The deterministic diagnostic engine: spans, layers, cost, shape and
 * inefficiency patterns. Shared infrastructure that scenario delta
 * computation, findings synthesis and the hypothesis engine all depend on —
 * built once here. Covers A3 (cost foundations) and B1–B5 (structure
 * diagnostics) from the skill spec.
 */
export function computeMetrics(
  positions: Position[],
  rootId: string | null,
  issues: Pick<IngestIssue, "kind">[] = []
): DiagnosticMetrics {
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
  const layers = nodes.length === 0 ? 0 : Math.max(...depths) - Math.min(...depths) + 1;

  const singleReportNodes = nodes.filter((n) => n.flags.singleReport);
  const syntheticIds = new Set(tagged.filter((n) => n.synthetic).map((n) => n.id));
  const unpriced = estimateUnpriced(positions.filter((p) => !syntheticIds.has(p.id)));

  return {
    headcount: nodes.length,
    filledCount: nodes.filter((n) => n.status === "filled").length,
    vacantCount: nodes.filter((n) => n.status === "vacant").length,
    contingentCount: nodes.filter((n) => n.status === "contingent").length,
    // Headcount counts people; this counts establishment. The gap between
    // them is the agency population, and it is the gap a redesign argues over.
    totalFte: nodes.reduce((sum, n) => sum + n.fte, 0),
    clinicalFte: nodes.filter((n) => n.clinicalFlag).reduce((sum, n) => sum + n.fte, 0),
    clinicalCost: nodes.filter((n) => n.clinicalFlag).reduce((sum, n) => sum + n.cost * n.fte, 0),
    totalCost: nodes.reduce((sum, n) => sum + n.cost * n.fte, 0),
    totalCostFullyLoaded: totalFullyLoadedCost(nodes),
    unpricedCount: unpriced.length,
    unpricedEstimatedCost: unpriced.reduce((sum, u) => sum + (u.estimate?.amount ?? 0), 0),
    // Depth is measured from the top of the real structure, so the heading
    // nodes above it don't read as an extra management layer.
    layers,
    averageSpan:
      managers.length === 0
        ? 0
        : managers.reduce((sum, n) => sum + n.childIds.length, 0) / managers.length,
    thinSpanCount: nodes.filter((n) => n.flags.spanHealth === "thin" && n.childIds.length > 0)
      .length,
    wideSpanCount: nodes.filter((n) => n.flags.spanHealth === "wide").length,
    singleReportCount: singleReportNodes.length,
    singleReportCost: singleReportNodes.reduce((sum, n) => sum + n.cost * n.fte, 0),
    singleReportByFunction: singleReportConcentration(singleReportNodes),
    protectedCount: nodes.filter((n) => n.flags.protected).length,
    protectedByTier,
    protectedByDirectorate: protectedByDirectorate(tagged, rootId),
    controlGaps: findControlGaps(nodes.map((n) => n.title)),
    flaggedPatterns: buildFlaggedPatterns(nodes),
    spanByArchetype: spanArchetypeBreakdown(managers),
    layerBand: layerBandVerdict(layers),
    shape: classifyShape(nodes),
    hygiene: computeHygiene(nodes, issues),
  };
}

/** B1: thin/healthy/wide counts per work archetype, so a span finding names which calibration it used. */
function spanArchetypeBreakdown(managers: LayoutNode[]): SpanArchetypeBreakdown[] {
  const byArchetype = new Map<string, LayoutNode[]>();
  for (const m of managers) {
    const list = byArchetype.get(m.flags.spanArchetype) ?? [];
    list.push(m);
    byArchetype.set(m.flags.spanArchetype, list);
  }

  const labels = new Map(listArchetypes().map((a) => [a.id, a.label] as const));

  return [...byArchetype.entries()].map(([archetype, group]) => ({
    archetype,
    label: labels.get(archetype) ?? archetype,
    count: group.length,
    thinCount: group.filter((n) => n.flags.spanHealth === "thin").length,
    healthyCount: group.filter((n) => n.flags.spanHealth === "healthy").length,
    wideCount: group.filter((n) => n.flags.spanHealth === "wide").length,
  }));
}

/** B2: the whole-org layer count against the absolute peer band. */
function layerBandVerdict(layers: number): LayerBandVerdict {
  const verdict =
    layers > LAYER_BAND.flagAbove ? "over-band" : layers < LAYER_BAND.healthyMin ? "under-band" : "in-band";
  return { layers, ...LAYER_BAND, verdict };
}

/** E1: held-role counts by directorate, so a coverage gap is visible per part of the business. */
function protectedByDirectorate(
  tagged: LayoutNode[],
  rootId: string | null
): { directorate: string; count: number }[] {
  const real = tagged.filter((n) => !n.synthetic && n.flags.protected);
  if (real.length === 0) return [];

  const directorates = divisionOf(tagged, rootId);
  const counts = new Map<string, number>();
  for (const n of real) {
    const d = directorates.get(n.id) ?? n.title;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([directorate, count]) => ({ directorate, count }))
    .sort((a, b) => b.count - a.count);
}

/** B3: where single-report management chains concentrate, by function. */
function singleReportConcentration(nodes: LayoutNode[]): SingleReportConcentration[] {
  const byFunction = new Map<string, LayoutNode[]>();
  for (const n of nodes) {
    const list = byFunction.get(n.functionGroup) ?? [];
    list.push(n);
    byFunction.set(n.functionGroup, list);
  }
  return [...byFunction.entries()]
    .map(([functionGroup, group]) => ({
      functionGroup,
      count: group.length,
      cost: group.reduce((sum, n) => sum + n.cost * n.fte, 0),
    }))
    .sort((a, b) => b.cost - a.cost);
}

function buildFlaggedPatterns(nodes: LayoutNode[]): FlaggedPattern[] {
  const patterns: FlaggedPattern[] = [];

  const thin = nodes.filter((n) => n.flags.spanHealth === "thin" && n.childIds.length > 0);
  if (thin.length > 0) {
    patterns.push({
      id: "thin-spans",
      label: "Thin spans of control",
      detail: `${thin.length} manager${thin.length === 1 ? "" : "s"} with fewer direct reports than the healthy range for their work archetype — a flattening or consolidation candidate.`,
      positionIds: thin.map((n) => n.id),
    });
  }

  const wide = nodes.filter((n) => n.flags.spanHealth === "wide");
  if (wide.length > 0) {
    patterns.push({
      id: "wide-spans",
      label: "Wide spans of control",
      detail: `${wide.length} manager${wide.length === 1 ? "" : "s"} with more direct reports than the healthy range for their work archetype — a support or delayering risk.`,
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
  breachedPositionIds: string[],
  keyPersonTouched = 0
): MetricsDelta {
  return {
    headcountDelta: scenario.headcount - baseline.headcount,
    costDelta: scenario.totalCost - baseline.totalCost,
    layersDelta: scenario.layers - baseline.layers,
    averageSpanDelta: scenario.averageSpan - baseline.averageSpan,
    safeStaffingBreach: breachedPositionIds.length > 0,
    breachedPositionIds,
    keyPersonTouched,
  };
}
