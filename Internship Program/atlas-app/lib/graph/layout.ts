import type { Position } from "./types";

export const NODE_WIDTH = 260;
export const ROW_HEIGHT = 160;

export interface LayoutResult {
  x: number;
  y: number;
  depth: number;
  childIds: string[];
}

/**
 * Deterministic tree layout: depth-first, x = midpoint of children's x (a
 * running cursor for leaves), y = depth * row height. No layout library —
 * this is the reference build's own ~15-line recursive function, per the
 * org-visualisation skill spec.
 */
export function computeLayout(
  positions: Position[],
  rootId: string | null
): Map<string, LayoutResult> {
  const byId = new Map(positions.map((p) => [p.id, p] as const));
  const childrenOf = new Map<string, string[]>();

  for (const p of positions) {
    if (p.managerId && byId.has(p.managerId)) {
      const list = childrenOf.get(p.managerId) ?? [];
      list.push(p.id);
      childrenOf.set(p.managerId, list);
    }
  }
  // Deterministic child order regardless of source row order.
  for (const list of childrenOf.values()) {
    list.sort((a, b) => (byId.get(a)!.title < byId.get(b)!.title ? -1 : 1));
  }

  const result = new Map<string, LayoutResult>();
  let cursor = 0;

  function visit(id: string, depth: number): number {
    const childIds = childrenOf.get(id) ?? [];

    if (childIds.length === 0) {
      const x = cursor * NODE_WIDTH;
      cursor += 1;
      result.set(id, { x, y: depth * ROW_HEIGHT, depth, childIds });
      return x;
    }

    const childXs = childIds.map((childId) => visit(childId, depth + 1));
    const x = (Math.min(...childXs) + Math.max(...childXs)) / 2;
    result.set(id, { x, y: depth * ROW_HEIGHT, depth, childIds });
    return x;
  }

  if (rootId && byId.has(rootId)) {
    visit(rootId, 0);
  }

  // Any position unreachable from the declared root (shouldn't happen post
  // ingest resolution, but defensive) still gets a position so nothing
  // silently disappears from the map.
  for (const p of positions) {
    if (!result.has(p.id)) {
      const x = cursor * NODE_WIDTH;
      cursor += 1;
      result.set(p.id, { x, y: 0, depth: 0, childIds: childrenOf.get(p.id) ?? [] });
    }
  }

  return result;
}
