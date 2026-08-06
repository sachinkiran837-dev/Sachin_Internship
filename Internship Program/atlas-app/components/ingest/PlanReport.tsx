"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, Filter, Layers, MessageSquareQuote, Ungroup } from "lucide-react";
import type { IngestPlan } from "@/lib/ingest/plan";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * How the instructions given on an earlier screen were actually read.
 *
 * This only appears when there's something to act on — a refusal to read the
 * instructions at all, or something asked for that couldn't be done. Either
 * one is a one-line fact; the accounting behind it — what was typed, how each
 * file was used, what got consolidated — sits behind an expand for whoever
 * wants to see the working.
 */
export function PlanReport({ context, plan }: { context: string; plan: IngestPlan | null }) {
  const [open, setOpen] = useState(false);
  if (!context.trim()) return null;

  const readByRule = plan?.source === "rules";
  const unread = plan === null || (plan.source !== "ai" && plan.source !== "rules");
  const decided = plan?.files ?? [];
  const warnings = plan?.warnings ?? [];

  // Instructions that were read by a model and fully applied, with nothing
  // left over, are not something the client needs to act on. A refusal, a
  // leftover warning, and a partial pattern-only reading all earn a place
  // among the issues — the last one because it never claims to have
  // understood the whole sentence, only matched a piece of it.
  if (!unread && !readByRule && warnings.length === 0) return null;

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>What you told Atlas about these files</CardTitle>
          <Badge variant={unread ? "destructive" : readByRule ? "outline" : "secondary"} className="shrink-0">
            {unread ? "Not applied" : readByRule ? "Partly applied" : "Applied"}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {unread
            ? "These instructions were stored but did not shape the files — bound by column names alone."
            : readByRule
              ? "No model was available, so only a pattern Atlas already recognised was applied — not the whole sentence."
              : `${warnings.length} thing${warnings.length === 1 ? "" : "s"} asked for could not be done.`}
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 text-sm">
        {warnings.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <p className="mb-1 flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
              <AlertTriangle className="size-4" aria-hidden />
              Asked for, but not done
            </p>
            <ul className="list-disc pl-5 text-amber-900 dark:text-amber-200">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown
            className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
          {open ? "Hide" : "Show"} what you told Atlas, and how it was read
        </button>

        {open && (
          <div className="flex flex-col gap-4 border-t pt-4">
            <blockquote className="flex gap-2 border-l-2 border-primary/50 pl-3 italic text-muted-foreground">
              <MessageSquareQuote className="mt-0.5 size-4 shrink-0 not-italic" aria-hidden />
              <span className="whitespace-pre-line">{context.trim()}</span>
            </blockquote>

            {plan?.notes && !unread && (
              <div>
                <p className="mb-0.5 font-medium">How Atlas read that</p>
                <p className="whitespace-pre-line text-muted-foreground">{plan.notes}</p>
              </div>
            )}

            {decided.length > 0 && (
              <div>
                <p className="mb-2 font-medium">What each file was used for</p>
                <ul className="flex flex-col gap-1.5">
                  {decided.map((f) => (
                    <li key={f.filename} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-xs">{f.filename}</span>
                      <Badge variant="outline" className="shrink-0 text-[11px]">
                        {USE_LABEL[f.use]}
                      </Badge>
                      {f.reason && <span className="text-muted-foreground">{f.reason}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(plan?.groupBy || plan?.rowFilter || plan?.functionGrouping) && (
              <div className="flex flex-col gap-2">
                {plan.functionGrouping === "asStated" && (
                  <p className="flex items-start gap-2 text-muted-foreground">
                    <Ungroup className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <span>
                      Function left as stated — departments were not rolled up into broader groups.
                      Every comparison on the findings screen runs on them exactly as your files
                      named them.
                    </span>
                  </p>
                )}

                {plan.groupBy && (
                  <p className="flex items-start gap-2 text-muted-foreground">
                    <Layers className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <span>
                      Consolidated at{" "}
                      <strong className="font-medium text-foreground">
                        {plan.groupBy.label.toLowerCase()}
                      </strong>{" "}
                      level, on the{" "}
                      {plan.groupBy.columns.map((column, i) => (
                        <span key={column}>
                          {i > 0 && (i === plan.groupBy!.columns.length - 1 ? " and " : ", ")}
                          <span className="font-mono text-xs">{column}</span>
                        </span>
                      ))}{" "}
                      column{plan.groupBy.columns.length === 1 ? "" : "s"}. Each one has a heading
                      under &ldquo;{plan.groupBy.topLabel}&rdquo;; those headings are structure, not
                      jobs, and are left out of every count.
                    </span>
                  </p>
                )}

                {plan.rowFilter && (
                  <p className="flex items-start gap-2 text-muted-foreground">
                    <Filter className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <span>
                      Scope narrowed on the{" "}
                      <span className="font-mono text-xs">{plan.rowFilter.column}</span> column
                      {plan.rowFilter.include.length > 0 &&
                        `, keeping only ${plan.rowFilter.include.join(", ")}`}
                      {plan.rowFilter.exclude.length > 0 &&
                        `, dropping ${plan.rowFilter.exclude.join(", ")}`}
                      . Every figure on the following screens is of what remained.
                    </span>
                  </p>
                )}
              </div>
            )}

            {unread && (
              <p className="text-muted-foreground">
                The files were bound by their column names alone — exactly as they would have been
                with the box left empty. Nothing here was guessed at.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const USE_LABEL: Record<string, string> = {
  positions: "The establishment",
  attributes: "Detail joined on",
  structure: "Reporting lines",
  ignore: "Left out",
};
