"use client";

import { Handle, Position as RFPosition, type NodeProps } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import type { LayoutNode } from "@/lib/graph/types";

export interface OrgNodeData extends Record<string, unknown> {
  position: LayoutNode;
  dimmed: boolean;
  hasChildren: boolean;
  expanded: boolean;
  onToggleExpand: (id: string) => void;
}

export function OrgNodeCard({ data }: NodeProps) {
  const { position: p, dimmed, hasChildren, expanded, onToggleExpand } = data as OrgNodeData;

  const spanColor =
    p.flags.spanHealth === "thin"
      ? "border-amber-400"
      : p.flags.spanHealth === "wide"
        ? "border-rose-400"
        : "border-border";

  return (
    <div
      className={`w-[220px] rounded-lg border-2 bg-card px-3 py-2 shadow-sm transition-opacity ${spanColor} ${
        dimmed ? "opacity-30" : "opacity-100"
      }`}
    >
      <Handle type="target" position={RFPosition.Top} className="!bg-muted-foreground" />
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{p.title}</p>
          <p className="truncate text-xs text-muted-foreground">{p.displayName}</p>
          <p className="truncate text-xs text-muted-foreground">{p.department}</p>
        </div>
        {hasChildren && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(p.id);
            }}
            className="shrink-0 rounded border px-1.5 text-xs hover:bg-accent"
          >
            {expanded ? "−" : "+"}
          </button>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {p.flags.protected && (
          <Badge variant="destructive" className="text-[10px]">
            {p.flags.protected.tier}
          </Badge>
        )}
        {p.flags.vacant && (
          <Badge variant="outline" className="text-[10px]">
            vacant
          </Badge>
        )}
        {p.flags.contingent && (
          <Badge variant="outline" className="text-[10px]">
            contingent
          </Badge>
        )}
        {p.flags.singleReport && (
          <Badge variant="secondary" className="text-[10px]">
            single-report
          </Badge>
        )}
        {p.flags.keyPerson && (
          <Badge variant="secondary" className="text-[10px]">
            key person
          </Badge>
        )}
      </div>
      <Handle type="source" position={RFPosition.Bottom} className="!bg-muted-foreground" />
    </div>
  );
}
