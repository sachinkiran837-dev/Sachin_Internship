import type { Position } from "./types";

export function getDescendantIds(positions: Position[], rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const p of positions) {
    if (!p.managerId) continue;
    const list = children.get(p.managerId) ?? [];
    list.push(p.id);
    children.set(p.managerId, list);
  }

  const result = new Set<string>();
  const stack = [...(children.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return result;
}

export function getAncestorIds(positions: Position[], id: string): Set<string> {
  const byId = new Map(positions.map((p) => [p.id, p] as const));
  const result = new Set<string>();
  let cursor = byId.get(id)?.managerId ?? null;
  while (cursor) {
    if (result.has(cursor)) break;
    result.add(cursor);
    cursor = byId.get(cursor)?.managerId ?? null;
  }
  return result;
}
