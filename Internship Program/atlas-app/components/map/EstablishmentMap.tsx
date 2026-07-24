"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
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

import { tagNodes } from "@/lib/graph/tagging";
import { computeVisibleLayout } from "@/lib/graph/layout";
import { getAncestorIds, getDescendantIds } from "@/lib/graph/descendants";
import { nearestCandidate } from "@/lib/graph/hitTest";
import type { Position } from "@/lib/graph/types";
import { reassignPosition } from "@/lib/scenario/mutate";
import { OrgNodeCard, type OrgNodeData } from "./OrgNodeCard";
import { DetailPanel } from "./DetailPanel";
import { MapLegend } from "./MapLegend";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const nodeTypes = { orgNode: OrgNodeCard };
const MAX_DROP_DISTANCE = 300;

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

export function EstablishmentMap({
  orgId,
  scenarioId,
  positions,
  rootId,
}: {
  orgId: string;
  scenarioId: string | null;
  positions: Position[];
  rootId: string | null;
}) {
  return (
    <ReactFlowProvider>
      <EstablishmentMapInner
        orgId={orgId}
        scenarioId={scenarioId}
        positions={positions}
        rootId={rootId}
      />
    </ReactFlowProvider>
  );
}

function EstablishmentMapInner({
  orgId,
  scenarioId,
  positions,
  rootId,
}: {
  orgId: string;
  scenarioId: string | null;
  positions: Position[];
  rootId: string | null;
}) {
  const layoutNodes = useMemo(() => tagNodes(positions, rootId), [positions, rootId]);
  const byId = useMemo(() => new Map(layoutNodes.map((n) => [n.id, n] as const)), [layoutNodes]);
  const departments = useMemo(
    () => Array.from(new Set(positions.map((p) => p.department))).sort(),
    [positions]
  );

  // User-driven expand/collapse toggles only. Filter/search-driven visibility
  // is layered on top as a derived value (effectiveExpandedIds) rather than
  // mutated in here, so a transient search never permanently changes it.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    rootId ? new Set([rootId]) : new Set()
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterDept, setFilterDept] = useState("all");
  const [filterFlag, setFilterFlag] = useState("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragOverride, setDragOverride] = useState<{ id: string; x: number; y: number } | null>(null);
  const [, startTransition] = useTransition();
  const { setCenter, fitView } = useReactFlow();

  const matches = useMemo(() => {
    const hasFilter = filterDept !== "all" || filterFlag !== "all" || search.trim() !== "";
    if (!hasFilter) return new Set<string>();

    const q = search.trim().toLowerCase();
    return new Set(
      layoutNodes
        .filter((n) => {
          if (filterDept !== "all" && n.department !== filterDept) return false;
          if (filterFlag !== "all") {
            const flagMatch =
              (filterFlag === "protected" && n.flags.protected) ||
              (filterFlag === "vacant" && n.flags.vacant) ||
              (filterFlag === "contingent" && n.flags.contingent) ||
              (filterFlag === "thin" && n.flags.spanHealth === "thin") ||
              (filterFlag === "wide" && n.flags.spanHealth === "wide") ||
              (filterFlag === "singleReport" && n.flags.singleReport) ||
              (filterFlag === "keyPerson" && n.flags.keyPerson);
            if (!flagMatch) return false;
          }
          if (q && !n.title.toLowerCase().includes(q) && !n.displayName.toLowerCase().includes(q)) {
            return false;
          }
          return true;
        })
        .map((n) => n.id)
    );
  }, [layoutNodes, filterDept, filterFlag, search]);

  const hasActiveFilter = matches.size > 0 || filterDept !== "all" || filterFlag !== "all" || search.trim() !== "";

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
    setFilterDept("all");
    setFilterFlag("all");
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
        <div className="flex flex-col gap-1">
          <Label htmlFor="map-dept" className="text-xs text-muted-foreground">
            Department
          </Label>
          <select
            id="map-dept"
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            value={filterDept}
            onChange={(e) => setFilterDept(e.target.value)}
          >
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="map-flag" className="text-xs text-muted-foreground">
            Flag
          </Label>
          <select
            id="map-flag"
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            value={filterFlag}
            onChange={(e) => setFilterFlag(e.target.value)}
          >
            <option value="all">All flags</option>
            <option value="protected">Protected</option>
            <option value="vacant">Vacant</option>
            <option value="contingent">Contingent</option>
            <option value="thin">Thin span</option>
            <option value="wide">Wide span</option>
            <option value="singleReport">Single-report</option>
            <option value="keyPerson">Key person</option>
          </select>
        </div>

        {hasActiveFilter && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              {matches.size} match{matches.size === 1 ? "" : "es"}
            </span>
            <button
              type="button"
              onClick={resetFilters}
              className="h-9 rounded-md border border-input px-2 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              Clear filters
            </button>
          </div>
        )}

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
