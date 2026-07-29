import { currency } from "@/lib/format/currency";
import type { DiagnosticMetrics } from "@/lib/graph/types";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-lg font-semibold tabular-nums text-foreground">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/** A quick-orientation stat strip so the numbers behind the canvas are legible before you start navigating it. */
export function MapStats({ metrics }: { metrics: DiagnosticMetrics }) {
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-2 border-b bg-card px-4 py-3">
      <Stat label="Positions" value={String(metrics.headcount)} />
      <Stat label="Layers" value={String(metrics.layers)} />
      <Stat label="Avg. span" value={metrics.averageSpan.toFixed(1)} />
      <Stat label="Fully-loaded cost" value={currency(metrics.totalCost)} />
      <Stat label="Protected roles" value={String(metrics.protectedCount)} />
      <Stat label="Vacant" value={String(metrics.vacantCount)} />
      <Stat label="Agency / contingent" value={String(metrics.contingentCount)} />
      <Stat label="Contracted FTE" value={metrics.totalFte.toFixed(0)} />
    </div>
  );
}
