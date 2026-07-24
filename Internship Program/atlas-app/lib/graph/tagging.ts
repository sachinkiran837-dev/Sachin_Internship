import spanConfig from "@/config/span-thresholds.json";
import { matchProtectedRole } from "@/lib/protected-roles/match";
import type { LayoutNode, NodeFlags, Position, SpanThresholds } from "./types";
import { computeLayout } from "./layout";

const SPAN_THRESHOLDS: SpanThresholds = spanConfig;

/**
 * Tags every node in one pass with the derived flags the map, filter panel
 * and diagnostics all read: protected/tier/instrument/reason, unit-roster,
 * single-report, thin/wide span, key-person, vacant, contingent.
 */
export function tagNodes(positions: Position[], rootId: string | null): LayoutNode[] {
  const layout = computeLayout(positions, rootId);
  const byManager = new Map<string | null, Position[]>();

  for (const p of positions) {
    const list = byManager.get(p.managerId) ?? [];
    list.push(p);
    byManager.set(p.managerId, list);
  }

  const titleCounts = new Map<string, number>();
  for (const p of positions) {
    titleCounts.set(p.title, (titleCounts.get(p.title) ?? 0) + 1);
  }

  return positions.map((p) => {
    const layoutInfo = layout.get(p.id) ?? { x: 0, y: 0, depth: 0, childIds: [] };
    const spanSize = layoutInfo.childIds.length;
    const siblings = byManager.get(p.managerId) ?? [];

    const flags: NodeFlags = {
      protected: matchProtectedRole(p.title),
      unitRoster: spanSize === 0 && siblings.length >= 3,
      singleReport: spanSize === 1,
      spanHealth:
        spanSize === 0
          ? "healthy"
          : spanSize < SPAN_THRESHOLDS.healthyMin
            ? "thin"
            : spanSize > SPAN_THRESHOLDS.healthyMax
              ? "wide"
              : "healthy",
      keyPerson: spanSize > 0 && (titleCounts.get(p.title) ?? 0) === 1,
      vacant: p.status === "vacant",
      contingent: p.status === "contingent",
    };

    return { ...p, ...layoutInfo, flags };
  });
}
