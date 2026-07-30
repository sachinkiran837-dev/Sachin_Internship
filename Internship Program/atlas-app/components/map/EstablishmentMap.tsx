"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { SlidersHorizontal } from "lucide-react";

import { tagNodes } from "@/lib/graph/tagging";
import { computeVisibleLayout } from "@/lib/graph/layout";
import { getAncestorIds, getDescendantIds } from "@/lib/graph/descendants";
import { nearestCandidate } from "@/lib/graph/hitTest";
import { type LayoutNode, type Position } from "@/lib/graph/types";
import { bandOf, NOT_STATED, type Facet } from "@/lib/canonical/facets";
import type { CanonicalRow } from "@/lib/canonical/table";
import { reassignPosition } from "@/lib/scenario/mutate";
import { OrgNodeCard, type OrgNodeData } from "./OrgNodeCard";
import { DetailPanel } from "./DetailPanel";
import { MapLegend } from "./MapLegend";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const nodeTypes = { orgNode: OrgNodeCard };
const MAX_DROP_DISTANCE = 300;

/** The "not filtering on this" value, kept out of the facet options. */
const ALL = "all";

/* ------------------------------------------------------------------ */
/* Which filters this person wants on screen, remembered per org.     */
/* ------------------------------------------------------------------ */

/**
 * Eight filters is more than anyone works with at once, and fewer than some
 * clients need — a group operator lives in the Brand filter, a single-entity
 * client has no use for it. So the choice is theirs and it sticks, because
 * re-picking it on every visit is the small friction that makes a tool feel
 * like it is not listening.
 *
 * Read through useSyncExternalStore rather than an effect: localStorage does
 * not exist while the page is rendered on the server, and the server snapshot
 * is what stops the first client render disagreeing with the HTML it hydrates.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab changing it counts too — the same person, the same preference.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private browsing, or a blocked origin. Defaults, and no error on screen.
    return null;
  }
}

function writeStored(key: string, keys: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(keys));
  } catch {
    // The choice holds for this visit and no longer.
  }
  for (const listener of listeners) listener();
}

/** The saved keys, or null when nothing valid is saved. */
function parseStored(raw: string | null, facets: Facet[]): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    // A facet that no longer exists — a Brand filter on an establishment that
    // is no longer consolidated — is dropped rather than left as a dead key.
    return parsed.filter((k): k is string => typeof k === "string" && facets.some((f) => f.key === k));
  } catch {
    return null;
  }
}

/**
 * Whether a node satisfies one filter.
 *
 * Everything but the flags is read off the canonical row, which is the whole
 * point: the map and the table then filter and display the same figures, and
 * cannot disagree about which function someone is in.
 *
 * The flags are a predicate rather than a value because a position can carry
 * several at once — a vacant role can also be a wide span — so asking for
 * vacancies must not be answered with whichever flag happens to be checked
 * first.
 */
function facetMatches(
  facet: Facet,
  want: string,
  node: LayoutNode,
  row: CanonicalRow | undefined
): boolean {
  if (facet.kind === "flag") {
    const f = node.flags;
    switch (want) {
      case "protected":
        return f.protected !== null;
      case "vacant":
        return f.vacant;
      case "contingent":
        return f.contingent;
      case "thin":
        return f.spanHealth === "thin";
      case "wide":
        return f.spanHealth === "wide";
      case "singleReport":
        return f.singleReport;
      case "keyPerson":
        return f.keyPerson;
      default:
        return true;
    }
  }

  if (!row) return want === NOT_STATED;

  if (facet.kind === "band") {
    const value =
      facet.key === "fte" ? row.fte : facet.key === "salary" ? row.salary : row.annualCost;
    return bandOf(facet, value) === want;
  }

  const text =
    facet.key === "function"
      ? row.department
      : facet.key === "departmentAsStated"
        ? row.departmentAsStated
        : facet.key === "manager"
          ? row.manager
          : facet.key === "employmentType"
            ? row.employmentType
            : row.brand;

  const value = text.trim();
  return (value === "" ? NOT_STATED : value) === want;
}

function computeTeamSize(positions: Position[], id: string): { size: number; cost: number } {
  const descendants = getDescendantIds(positions, id);
  const byId = new Map(positions.map((p) => [p.id, p] as const));
  const self = byId.get(id);
  let cost = self ? self.cost * self.fte : 0;
  for (const dId of descendants) {
    const d = byId.get(dId);
    if (d) cost += d.cost * d.fte;
  }
  return { size: descendants.size + 1, cost };
}

export interface MapProps {
  orgId: string;
  scenarioId: string | null;
  positions: Position[];
  rootId: string | null;
  /** The canonical table for these positions. What the filters read. */
  rows: CanonicalRow[];
  /** Which columns can be filtered on, derived from those rows. */
  facets: Facet[];
}

export function EstablishmentMap(props: MapProps) {
  return (
    <ReactFlowProvider>
      <EstablishmentMapInner {...props} />
    </ReactFlowProvider>
  );
}

function EstablishmentMapInner({
  orgId,
  scenarioId,
  positions,
  rootId,
  rows,
  facets,
}: MapProps) {
  const layoutNodes = useMemo(() => tagNodes(positions, rootId), [positions, rootId]);
  const byId = useMemo(() => new Map(layoutNodes.map((n) => [n.id, n] as const)), [layoutNodes]);

  /** The canonical row for each position, so the filters read the table. */
  const rowById = useMemo(
    () => new Map(rows.map((r) => [r.positionId, r] as const)),
    [rows]
  );

  // User-driven expand/collapse toggles only. Filter/search-driven visibility
  // is layered on top as a derived value (effectiveExpandedIds) rather than
  // mutated in here, so a transient search never permanently changes it.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    rootId ? new Set([rootId]) : new Set()
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Facet key → the chosen value. A key absent from here is not filtering. */
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [choosing, setChoosing] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragOverride, setDragOverride] = useState<{ id: string; x: number; y: number } | null>(null);
  const [, startTransition] = useTransition();
  const { setCenter, fitView } = useReactFlow();

  const storageKey = `atlas:map-filters:${orgId}`;
  const stored = useSyncExternalStore(
    subscribe,
    () => readStored(storageKey),
    () => null
  );

  const shown = useMemo(
    () => parseStored(stored, facets) ?? facets.filter((f) => f.defaultOn).map((f) => f.key),
    [stored, facets]
  );

  const setShownAndRemember = useCallback(
    (keys: string[]) => {
      // Clearing a filter's box has to clear the filter too, or the map stays
      // narrowed by a control nobody can see any more.
      setSelection((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([k]) => keys.includes(k)))
      );
      writeStored(storageKey, keys);
    },
    [storageKey]
  );

  const visibleFacets = useMemo(
    () => facets.filter((f) => shown.includes(f.key)),
    [facets, shown]
  );

  const active = useMemo(
    () => Object.entries(selection).filter(([, v]) => v && v !== ALL),
    [selection]
  );

  const matches = useMemo(() => {
    if (active.length === 0 && search.trim() === "") return new Set<string>();

    const q = search.trim().toLowerCase();
    const byKey = new Map(facets.map((f) => [f.key, f] as const));

    return new Set(
      layoutNodes
        .filter((n) => {
          // Headings are scaffolding, not people, and carry no canonical row.
          if (n.synthetic) return false;
          const row = rowById.get(n.id);

          for (const [key, want] of active) {
            const facet = byKey.get(key);
            if (!facet) continue;
            if (!facetMatches(facet, want, n, row)) return false;
          }

          if (q && !n.title.toLowerCase().includes(q) && !n.displayName.toLowerCase().includes(q)) {
            return false;
          }
          return true;
        })
        .map((n) => n.id)
    );
  }, [layoutNodes, rowById, facets, active, search]);

  const hasActiveFilter = active.length > 0 || search.trim() !== "";

  const ancestorsOfMatches = useMemo(() => {
    const result = new Set<string>();
    for (const id of matches) {
      for (const a of getAncestorIds(positions, id)) result.add(a);
    }
    return result;
  }, [matches, positions]);

  // The path to every match is force-expanded for display purposes, without
  // mutating the user's own manual expand/collapse state.
  const effectiveExpandedIds = useMemo(() => {
    if (ancestorsOfMatches.size === 0) return expandedIds;
    const next = new Set(expandedIds);
    for (const id of ancestorsOfMatches) next.add(id);
    return next;
  }, [expandedIds, ancestorsOfMatches]);

  const visibleIds = useMemo(() => {
    const visible = new Set<string>();
    function visit(id: string) {
      visible.add(id);
      if (!effectiveExpandedIds.has(id)) return;
      const node = byId.get(id);
      node?.childIds.forEach(visit);
    }
    if (rootId) visit(rootId);
    return visible;
  }, [byId, effectiveExpandedIds, rootId]);

  // Positions scoped to what's actually visible — a collapsed node never
  // reserves the horizontal width of its hidden subtree (see
  // computeVisibleLayout). This is what keeps the canvas compact regardless
  // of how large the underlying org is.
  const visibleLayout = useMemo(
    () => computeVisibleLayout(layoutNodes, rootId, visibleIds, effectiveExpandedIds),
    [layoutNodes, rootId, visibleIds, effectiveExpandedIds]
  );

  // Search flies the view to the first hit — an imperative call to the
  // canvas's own camera API, not a state sync, so it belongs in an effect.
  useEffect(() => {
    if (search.trim() === "" || matches.size === 0) return;
    const firstId = [...matches][0];
    const pos = visibleLayout.get(firstId);
    if (pos) setCenter(pos.x + 110, pos.y + 40, { zoom: 1, duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Bulk actions re-fit the camera afterward — a deliberate click on "expand
  // all"/"collapse to top" means the visible extent just changed a lot, so
  // the view should follow. A single per-node toggle deliberately does not
  // do this (it would fight the search fly-to and be disorienting while
  // incrementally exploring one branch).
  const expandAll = useCallback(() => {
    setExpandedIds(new Set(layoutNodes.filter((n) => n.childIds.length > 0).map((n) => n.id)));
    setTimeout(() => fitView({ duration: 400, padding: 0.2 }), 50);
  }, [layoutNodes, fitView]);

  const collapseAll = useCallback(() => {
    setExpandedIds(rootId ? new Set([rootId]) : new Set());
    setTimeout(() => fitView({ duration: 400, padding: 0.2 }), 50);
  }, [rootId, fitView]);

  const resetFilters = useCallback(() => {
    setSelection({});
    setSearch("");
  }, []);

  const layoutRfNodes = useMemo<Node[]>(() => {
    return [...visibleIds].map((id) => {
      const n = byId.get(id)!;
      const pos = visibleLayout.get(id) ?? { x: n.x, y: n.y };
      const dimmed = hasActiveFilter && !matches.has(id) && !ancestorsOfMatches.has(id);
      const data: OrgNodeData = {
        position: n,
        dimmed,
        hasChildren: n.childIds.length > 0,
        expanded: effectiveExpandedIds.has(id),
        onToggleExpand: toggleExpand,
      };
      return {
        id,
        type: "orgNode",
        position: pos,
        data,
        draggable: id !== rootId,
      };
    });
  }, [
    visibleIds,
    byId,
    visibleLayout,
    hasActiveFilter,
    matches,
    ancestorsOfMatches,
    effectiveExpandedIds,
    toggleExpand,
    rootId,
  ]);

  // Only the actively-dragged node's position is overridden for the
  // duration of the gesture; everything else always renders at its
  // deterministic layout position.
  const rfNodes = useMemo(() => {
    if (!dragOverride) return layoutRfNodes;
    return layoutRfNodes.map((n) =>
      n.id === dragOverride.id ? { ...n, position: { x: dragOverride.x, y: dragOverride.y } } : n
    );
  }, [layoutRfNodes, dragOverride]);

  const rfEdges = useMemo<Edge[]>(() => {
    const edges: Edge[] = [];
    for (const id of visibleIds) {
      const n = byId.get(id)!;
      if (n.managerId && visibleIds.has(n.managerId)) {
        edges.push({
          id: `${n.managerId}-${id}`,
          source: n.managerId,
          target: id,
          type: "smoothstep",
        });
      }
    }
    return edges;
  }, [visibleIds, byId]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    for (const change of changes) {
      if (change.type === "position" && change.dragging && change.position) {
        setDragOverride({ id: change.id, x: change.position.x, y: change.position.y });
      }
    }
  }, []);

  const onNodeDragStop = useCallback(
    (_event: unknown, draggedNode: Node) => {
      const draggedId = draggedNode.id;
      setDragOverride(null);
      if (draggedId === rootId) return;

      const excluded = new Set([draggedId, ...getDescendantIds(positions, draggedId)]);
      const dimmedIds = new Set(
        layoutRfNodes.filter((n) => (n.data as unknown as OrgNodeData).dimmed).map((n) => n.id)
      );

      const candidates = layoutRfNodes
        .filter((n) => !excluded.has(n.id) && !dimmedIds.has(n.id))
        .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));

      const targetId = nearestCandidate(
        { id: draggedId, x: draggedNode.position.x, y: draggedNode.position.y },
        candidates,
        MAX_DROP_DISTANCE
      );

      if (!targetId || targetId === positions.find((p) => p.id === draggedId)?.managerId) return;

      startTransition(async () => {
        const result = await reassignPosition(orgId, draggedId, targetId, scenarioId);
        setError(result.blocked ? (result.blockReason ?? "Blocked") : null);
      });
    },
    [layoutRfNodes, positions, rootId, orgId, scenarioId]
  );

  const selectedNode = selectedId ? (byId.get(selectedId) ?? null) : null;
  const managerNode = selectedNode?.managerId ? (byId.get(selectedNode.managerId) ?? null) : null;
  const team = selectedNode ? computeTeamSize(positions, selectedNode.id) : { size: 0, cost: 0 };

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex flex-wrap items-end gap-3 border-b bg-background px-4 py-2.5">
        <div className="flex flex-col gap-1">
          <Label htmlFor="map-search" className="text-xs text-muted-foreground">
            Search
          </Label>
          <Input
            id="map-search"
            placeholder="Title or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
        </div>
        {visibleFacets.map((facet) => (
          <div key={facet.key} className="flex flex-col gap-1">
            <Label htmlFor={`map-${facet.key}`} className="text-xs text-muted-foreground">
              {facet.label}
            </Label>
            <select
              id={`map-${facet.key}`}
              className="h-9 max-w-56 rounded-md border border-input bg-transparent px-2 text-sm"
              value={selection[facet.key] ?? ALL}
              onChange={(e) =>
                setSelection((prev) => ({ ...prev, [facet.key]: e.target.value }))
              }
            >
              <option value={ALL}>
                All ({facet.options.length})
              </option>
              {facet.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.count.toLocaleString()})
                </option>
              ))}
            </select>
          </div>
        ))}

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            {hasActiveFilter ? `${matches.size} match${matches.size === 1 ? "" : "es"}` : " "}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setChoosing((v) => !v)}
              aria-expanded={choosing}
              className="flex h-9 items-center gap-1.5 rounded-md border border-input px-2 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              <SlidersHorizontal className="size-4" aria-hidden />
              Filters
              <span className="text-xs text-muted-foreground">
                {visibleFacets.length}/{facets.length}
              </span>
            </button>
            {hasActiveFilter && (
              <button
                type="button"
                onClick={resetFilters}
                className="h-9 rounded-md border border-input px-2 text-sm hover:bg-accent hover:text-accent-foreground"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="ml-auto flex items-end gap-2">
          <button
            type="button"
            onClick={expandAll}
            className="h-9 rounded-md border border-input px-3 text-sm hover:bg-accent hover:text-accent-foreground"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="h-9 rounded-md border border-input px-3 text-sm hover:bg-accent hover:text-accent-foreground"
          >
            Collapse to top
          </button>
        </div>

        {choosing && (
          <div className="w-full rounded-md border bg-accent/20 px-4 py-3">
            <p className="mb-2 text-xs text-muted-foreground">
              The columns of your canonical table. Pick the ones worth having on screen — the
              choice is remembered for this establishment.
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {facets.map((facet) => {
                const on = shown.includes(facet.key);
                return (
                  <label
                    key={facet.key}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setShownAndRemember(
                          on
                            ? shown.filter((k) => k !== facet.key)
                            : [...shown, facet.key]
                        )
                      }
                      className="size-4 accent-primary"
                    />
                    {facet.label}
                    <span className="text-xs text-muted-foreground">
                      {facet.options.length}
                    </span>
                  </label>
                );
              })}
            </div>
            {facets.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nothing in this establishment has more than one distinct value to filter on.
              </p>
            )}
          </div>
        )}

        {error && <p className="w-full text-sm text-destructive">{error}</p>}
      </div>

      <MapLegend />

      <div className="relative flex-1 min-h-0">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={(_e, node) => setSelectedId(node.id)}
          fitView
          minZoom={0.05}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>

      <DetailPanel
        node={selectedNode}
        manager={managerNode}
        teamSize={team.size}
        teamCost={team.cost}
        open={selectedId !== null}
        onOpenChange={(open) => !open && setSelectedId(null)}
      />
    </div>
  );
}
