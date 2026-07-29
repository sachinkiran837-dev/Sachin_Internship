import { currency } from "@/lib/format/currency";
import { notFound } from "next/navigation";
import { Download, TriangleAlert } from "lucide-react";
import { getCleaningLedger, getOrg, getSourceFiles } from "@/db/repo";
import { loadCanonicalTable } from "@/lib/canonical/load";
import { OrgNav } from "@/components/OrgNav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

/** How many rows the page renders before it stops and points at the file. */
const PREVIEW_ROWS = 250;

/**
 * The clean table, and the record of what was thrown away to get it.
 *
 * These two belong on one screen. A table of 993 tidy rows is persuasive in a
 * way that is only earned if the eleven rows that are missing from it are
 * visible in the same place — otherwise the cleanest-looking export is the
 * one that quietly lost the most.
 */
export default async function CanonicalDataPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const org = await getOrg(orgId);
  if (!org) notFound();

  const table = await loadCanonicalTable(orgId);
  const ledger = await getCleaningLedger(orgId);
  const files = await getSourceFiles(orgId);

  const used = files.filter((f) => f.role !== "unusable");
  const removed = ledger.rowsIn - ledger.rowsOut;
  const flagged = table.rows.filter((r) => r.flags.length > 0).length;

  return (
    <div className="flex flex-1 flex-col">
      <OrgNav orgId={orgId} active="data" />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">
              <span className="eyebrow-dot" aria-hidden />
              Canonical table
            </p>
            <h1 className="mt-1 text-2xl">One row per person, six columns that matter</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Every file you uploaded reduced to the same shape: who they are, what function they
              sit in, whose company employs them, who they report to, whether they are contracted,
              and what they cost. This is what the engine reasons about — the map, the findings and
              every saving are computed from these rows and nothing else.
            </p>
          </div>
          <a
            href={`/org/${orgId}/data/canonical.csv`}
            className="inline-flex shrink-0 items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            <Download className="size-4" aria-hidden />
            Download CSV
          </a>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>How the six columns were filled</CardTitle>
            <p className="text-sm text-muted-foreground">
              {used.length === 1
                ? `From ${used[0].filename}.`
                : `${used.length} files bound into ${table.rows.length.toLocaleString()} rows.`}{" "}
              An empty cell is a fact about your source data — Atlas leaves it empty rather than
              filling it with something plausible.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {table.coverage.map((c) => {
              const pct = c.total === 0 ? 0 : (c.filled / c.total) * 100;
              return (
                <div key={c.column}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{c.column}</span>
                    <span className="text-sm text-muted-foreground">{pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={`h-full ${pct >= 90 ? "bg-primary" : pct >= 50 ? "bg-amber-500" : "bg-destructive"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.filled.toLocaleString()} of {c.total.toLocaleString()} · {c.note}
                  </p>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Deliberately above the table. The rows that are gone are harder to
            notice than the rows that are there, so they get read first. */}
        {removed > 0 && (
          <Card className="border-amber-500/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TriangleAlert className="size-4 shrink-0 text-amber-600" aria-hidden />
                {removed.toLocaleString()} row{removed === 1 ? "" : "s"} discarded before anything
                was built
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Out of {ledger.rowsIn.toLocaleString()} that arrived. Only rows that cannot describe
                a person are removed — an incomplete row is kept, so the establishment can show what
                is missing.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {ledger.dropped.map((d) => (
                <div key={d.reason}>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{d.count.toLocaleString()}</Badge>
                    <span className="font-medium">{d.reason}</span>
                  </div>
                  <ul className="mt-1 flex flex-col gap-0.5 pl-1 text-xs text-muted-foreground">
                    {d.examples.map((e, i) => (
                      <li key={i} className="truncate font-mono">
                        {e}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {ledger.repaired.length > 0 && (
                <p className="border-t pt-3 text-xs text-muted-foreground">
                  Repaired rather than removed:{" "}
                  {ledger.repaired.map((r) => `${r.count.toLocaleString()} × ${r.reason}`).join(", ")}
                  . These changed no count, cost or reporting line.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>
              The table ({table.rows.length.toLocaleString()} rows)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {flagged > 0
                ? `${flagged.toLocaleString()} rows carry a note about something missing or inferred — hover the row to read it. `
                : "Every row was filled from your files with nothing inferred. "}
              {table.rows.length > PREVIEW_ROWS &&
                `Showing the first ${PREVIEW_ROWS.toLocaleString()}; the CSV holds all ${table.rows.length.toLocaleString()}.`}
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Job title</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>{table.brandLabel}</TableHead>
                    <TableHead>Manager</TableHead>
                    <TableHead>Employment</TableHead>
                    <TableHead className="text-right">FTE</TableHead>
                    <TableHead className="text-right">Salary</TableHead>
                    <TableHead className="text-right">Annual cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {table.rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                    <TableRow key={i} title={r.flags.join(" · ")}>
                      <TableCell className="font-medium">{r.employee}</TableCell>
                      <TableCell className="text-muted-foreground">{r.title}</TableCell>
                      <TableCell>{r.department || <Missing />}</TableCell>
                      <TableCell>{r.brand || <Missing />}</TableCell>
                      <TableCell>{r.manager || <Missing />}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            r.employmentType === "Agency" || r.employmentType === "Vacant"
                              ? "outline"
                              : "secondary"
                          }
                          className="font-normal"
                        >
                          {r.employmentType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{r.fte.toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        {r.salary === null ? <Missing /> : currency(r.salary)}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.annualCost > 0 ? currency(r.annualCost) : <Missing />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

/** An empty cell that says it is empty, rather than looking like a zero. */
function Missing() {
  return <span className="text-xs text-muted-foreground">not stated</span>;
}
