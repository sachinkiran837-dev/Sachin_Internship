export function MapLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Legend</span>

      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm border-2 border-amber-400 bg-card" />
        Thin span (fewer reports than healthy)
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm border-2 border-rose-400 bg-card" />
        Wide span (more reports than healthy)
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-full bg-destructive/15 ring-1 ring-destructive/40" />
        Protected role — blocked from removal/reassignment
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-full bg-secondary ring-1 ring-border" />
        Agency / contingent — no contracted FTE
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-full border border-dashed border-muted-foreground/60 bg-card" />
        Vacant
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-full bg-secondary ring-1 ring-border" />
        Single-report / key person
      </span>
    </div>
  );
}
