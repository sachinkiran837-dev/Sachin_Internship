import { AlertTriangle, Filter, Layers, MessageSquareQuote } from "lucide-react";
import type { IngestPlan } from "@/lib/ingest/plan";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * How the instructions typed on the upload screen were actually read.
 *
 * This is the accountability half of the context box. Instructions in free
 * text are only trustworthy if the reading of them is shown back: "consolidate
 * at brand level" either found a brand column or it didn't, and the difference
 * is invisible from the map. So the user's own words sit next to what Atlas
 * concluded, next to everything it was asked for and could not do.
 *
 * It also has to be honest about not having read them at all — a deployment
 * with no AI key still accepts the instructions, and must say
 * plainly that they were recorded and ignored rather than letting a
 * well-formed map imply they were followed.
 */
export function PlanReport({ context, plan }: { context: string; plan: IngestPlan | null }) {
  if (!context.trim()) return null;

  const unread = plan === null || plan.source !== "ai";
  const decided = plan?.files ?? [];

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>What you told Atlas about these files</CardTitle>
          <Badge variant={unread ? "destructive" : "secondary"} className="shrink-0">
            {unread ? "Not applied" : "Applied"}
          </Badge>
        </div>
        <blockquote className="flex gap-2 border-l-2 border-primary/50 pl-3 text-sm italic text-muted-foreground">
          <MessageSquareQuote className="mt-0.5 size-4 shrink-0 not-italic" aria-hidden />
          <span className="whitespace-pre-line">{context.trim()}</span>
        </blockquote>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 border-t pt-5 text-sm">
        {/* When the instructions weren't read, the notes and the banner at the
            bottom say the same thing; only the banner should say it. */}
        {plan?.notes && !unread && (
          <div>
            <p className="mb-0.5 font-medium">How Atlas read that</p>
            <p className="whitespace-pre-line text-muted-foreground">{plan.notes}</p>
          </div>
        )}

        {plan === null && (
          <p className="text-muted-foreground">
            No instructions were applied to this ingest — the files were bound by their column
            names alone.
          </p>
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

        {(plan?.groupBy || plan?.rowFilter) && (
          <div className="flex flex-col gap-2">
            {plan.groupBy && (
              <p className="flex items-start gap-2 text-muted-foreground">
                <Layers className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>
                  Consolidated at <strong className="font-medium text-foreground">
                    {plan.groupBy.label.toLowerCase()}
                  </strong>{" "}
                  level, on the{" "}
                  {plan.groupBy.columns.map((column, i) => (
                    <span key={column}>
                      {i > 0 && (i === plan.groupBy!.columns.length - 1 ? " and " : ", ")}
                      <span className="font-mono text-xs">{column}</span>
                    </span>
                  ))}{" "}
                  column{plan.groupBy.columns.length === 1 ? "" : "s"}. Each one has a heading under &ldquo;{plan.groupBy.topLabel}&rdquo;;
                  those headings are structure, not jobs, and are left out of every count.
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

        {plan && plan.warnings.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <p className="mb-1 flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
              <AlertTriangle className="size-4" aria-hidden />
              Asked for, but not done
            </p>
            <ul className="list-disc pl-5 text-amber-900 dark:text-amber-200">
              {plan.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {unread && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
            These instructions were stored with the establishment but did not shape it. The files
            were bound by their column names alone — exactly as they would have been with the box
            left empty. Nothing here was guessed at.
          </p>
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
