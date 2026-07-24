"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import type { LayoutNode } from "@/lib/graph/types";

function currency(n: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);
}

export function DetailPanel({
  node,
  manager,
  teamSize,
  teamCost,
  open,
  onOpenChange,
}: {
  node: LayoutNode | null;
  manager: LayoutNode | null;
  teamSize: number;
  teamCost: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        {node && (
          <>
            <SheetHeader>
              <SheetTitle>{node.title}</SheetTitle>
              <SheetDescription>{node.displayName}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-4 pb-4 text-sm">
              <Field label="Department" value={node.department} />
              <Field label="Reports to" value={manager ? manager.title : "Top of house"} />
              <Field label="Direct reports" value={String(node.childIds.length)} />
              <Field label="Team beneath (incl. this role)" value={String(teamSize)} />
              <Field label="Team cost (fully loaded)" value={currency(teamCost)} />
              <Field label="Status" value={node.status} />

              {node.flags.protected && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <p className="font-medium text-destructive">
                    Protected {node.flags.protected.tier} control
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Instrument: {node.flags.protected.instrument}
                  </p>
                  <p className="text-muted-foreground">{node.flags.protected.reason}</p>
                </div>
              )}

              <div className="flex flex-wrap gap-1">
                {node.flags.vacant && <Badge variant="outline">vacant</Badge>}
                {node.flags.contingent && <Badge variant="outline">contingent</Badge>}
                {node.flags.singleReport && <Badge variant="secondary">single-report chain</Badge>}
                {node.flags.keyPerson && <Badge variant="secondary">key person</Badge>}
                {node.flags.spanHealth !== "healthy" && (
                  <Badge variant="secondary">{node.flags.spanHealth} span</Badge>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b pb-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
