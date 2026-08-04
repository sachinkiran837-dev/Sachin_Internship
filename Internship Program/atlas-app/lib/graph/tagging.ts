import spanConfig from "@/config/span-thresholds.json";
import { matchProtectedRole } from "@/lib/protected-roles/match";
import { classifyArchetype } from "./spanArchetype";
import type { LayoutNode, NodeFlags, Position, SpanThresholds } from "./types";
import { computeLayout } from "./layout";

const SPAN_THRESHOLDS: SpanThresholds = spanConfig;

/**
 * Tags every node in one pass with the derived flags the map, filter panel
 * and diagnostics all read: protected/tier/instrument/reason, unit-roster,
 * single-report, thin/wide span (against its B1 work-archetype band),
 * key-person, vacant, contingent.
 */
export function tagNodes(positions: Position[], rootId: string | null): LayoutNode[] {
  const layout = computeLayout(positions, rootId);
  const byId = new Map(positions.map((p) => [p.id, p] as const));

  const titleCounts = new Map<string, number>();
  for (const p of positions) {
    titleCounts.set(p.title, (titleCounts.get(p.title) ?? 0) + 1);
  }

  return positions.map((p) => {
    const layoutInfo = layout.get(p.id) ?? { x: 0, y: 0, depth: 0, childIds: [] };
    const spanSize = layoutInfo.childIds.length;
    const reports = layoutInfo.childIds
      .map((id) => byId.get(id))
      .filter((r): r is Position => Boolean(r));

    // A2: a manager staffing a large clinical/frontline roster is running a
    // 24/7 service, not a management span — a Nurse Unit Manager with 30
    // reports is safe-staffing accountable, not a wide-span outlier. This
    // exemption comes before archetype banding, not alongside it, because no
    // archetype band is the right one to apply here at all.
    const clinicalReports = reports.filter((r) => r.clinicalFlag).length;
    const isUnitRoster =
      spanSize >= SPAN_THRESHOLDS.unitRosterMin && clinicalReports / spanSize >= 0.5;

    const archetype = classifyArchetype(p);
    const thinBoundary = archetype.flagUnder ?? archetype.healthyMin;
    const wideBoundary = archetype.flagOver ?? archetype.healthyMax;

    const flags: NodeFlags = {
      protected: matchProtectedRole(p.title, isUnitRoster),
      unitRoster: isUnitRoster,
      singleReport: spanSize === 1,
      spanHealth:
        spanSize === 0 || isUnitRoster
          ? "healthy"
          : spanSize < thinBoundary
            ? "thin"
            : spanSize > wideBoundary
              ? "wide"
              : "healthy",
      spanArchetype: archetype.id,
      keyPerson: spanSize > 0 && (titleCounts.get(p.title) ?? 0) === 1,
      vacant: p.status === "vacant",
      contingent: p.status === "contingent",
    };

    return { ...p, ...layoutInfo, flags };
  });
}
