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

function currency(n: number): string {
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
}

export function OrgNodeCard({ data }: NodeProps) {
  const { position: p, dimmed, hasChildren, expanded, onToggleExpand } = data as OrgNodeData;

  // A heading node holds a consolidated map together — a brand or entity the
  // structure beneath it belongs to. It is drawn differently on purpose:
  // showing it as a card with a name and $0 would read as a vacant job.
  if (p.synthetic) {
    return (
      <div
        className={`w-[240px] rounded-lg border-2 border-dashed border-primary/50 bg-accent/40 px-3 py-2.5 transition-opacity ${
          dimmed ? "opacity-30" : "opacity-100"
        }`}
      >
        <Handle type="target" position={RFPosition.Top} className="!bg-muted-foreground" />
        <div className="flex items-start justify-between gap-1.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight text-foreground">
              {p.title}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Grouping — not a position, not counted
            </p>
          </div>
          {hasChildren && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(p.id);
              }}
              className="shrink-0 rounded-md border px-1.5 py-0.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
              aria-label={expanded ? "Collapse group" : `Expand ${p.childIds.length} below`}
            >
              {expanded ? "−" : `+${p.childIds.length}`}
            </button>
          )}
        </div>
        <Handle type="source" position={RFPosition.Bottom} className="!bg-muted-foreground" />
      </div>
    );
  }

  const spanColor =
    p.flags.spanHealth === "thin"
      ? "border-amber-400"
      : p.flags.spanHealth === "wide"
        ? "border-rose-400"
        : p.flags.protected
          ? "border-destructive/50"
          : "border-border";

  return (
    <div
      className={`w-[240px] rounded-lg border-2 bg-card px-3 py-2.5 shadow-sm transition-opacity ${spanColor} ${
        dimmed ? "opacity-30" : "opacity-100"
      }`}
    >
      <Handle type="target" position={RFPosition.Top} className="!bg-muted-foreground" />
      <div className="flex items-start justify-between gap-1.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight text-foreground">{p.title}</p>
          <p className="truncate text-xs text-muted-foreground">{p.displayName}</p>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="truncate">{p.department}</span>
            <span aria-hidden>·</span>
            <span className="shrink-0 tabular-nums">{currency(p.cost * p.fte)}</span>
          </div>
        </div>
        {hasChildren && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(p.id);
            }}
            className="shrink-0 rounded-md border px-1.5 py-0.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
            aria-label={expanded ? "Collapse team" : `Expand ${p.childIds.length} direct report${p.childIds.length === 1 ? "" : "s"}`}
          >
            {expanded ? "−" : `+${p.childIds.length}`}
          </button>
        )}
      </div>
      {(p.flags.protected ||
        p.flags.vacant ||
        p.flags.contingent ||
        p.flags.singleReport ||
        p.flags.keyPerson) && (
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
            <Badge variant="secondary" className="text-[10px]">
              {/* Zero contracted FTE is how a workforce system records agency
                  labour, so the card says which kind of contingent it is. */}
              {p.fte === 0 ? "agency" : "contingent"}
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
      )}
      <Handle type="source" position={RFPosition.Bottom} className="!bg-muted-foreground" />
    </div>
  );
}
