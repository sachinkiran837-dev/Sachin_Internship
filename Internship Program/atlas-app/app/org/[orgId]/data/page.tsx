import { currency } from "@/lib/format/currency";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Download } from "lucide-react";
import { getCleaningLedger, getOrg, hasSourceBlobs } from "@/db/repo";
import { loadCanonicalTable } from "@/lib/canonical/load";
import { OrgNav } from "@/components/OrgNav";
import { ContextRedo } from "@/components/ingest/ContextRedo";
import { Badge } from "@/components/ui/badge";
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
const PREVIEW_ROWS = 2000;

/**
 * The clean table, and almost nothing else.
 *
 * This screen used to explain itself at length — what the six columns are, how
 * completely each one was filled, what the scrub removed and why. All of that
 * is true and none of it belongs here: someone opening this screen has come to
 * read their data, and an explanation they did not ask for sits between them
 * and it every single time.
 *
 * One line is kept: the count of rows discarded before the table was built. A
 * table of 993 tidy rows is persuasive in a way that is only earned if the
 * eleven rows missing from it are acknowledged on the same screen — but
 * acknowledging them is a sentence, not a card, and the detail behind it is on
 * the register where every other reading Atlas made already lives.
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
  const removed = ledger.rowsIn - ledger.rowsOut;
  const canReread = await hasSourceBlobs(orgId);

  return (
    <div className="flex flex-1 flex-col">
      <OrgNav orgId={orgId} active="data" />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="eyebrow">
              <span className="eyebrow-dot" aria-hidden />
              Canonical table
            </p>
            <h1 className="mt-1 text-2xl">{table.rows.length.toLocaleString()} rows</h1>
          </div>
          <a
            href={`/org/${orgId}/data/canonical.csv`}
            className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Download className="size-4" aria-hidden />
            Download CSV
          </a>
        </div>

        <p className="text-xs text-muted-foreground">
          {removed > 0 && (
            <>
              {removed.toLocaleString()} row{removed === 1 ? "" : "s"} of{" "}
              {ledger.rowsIn.toLocaleString()} discarded before this was built —{" "}
              <Link href={`/org/${orgId}`} className="underline underline-offset-2">
                see why on the register
              </Link>
              .{" "}
            </>
          )}
          {table.rows.length > PREVIEW_ROWS
            ? `Showing the first ${PREVIEW_ROWS.toLocaleString()}; the CSV holds all ${table.rows.length.toLocaleString()}.`
            : "The CSV holds the same rows."}
        </p>

        <ContextRedo
          orgId={orgId}
          canReread={canReread}
          heading="Tell Atlas how to read this data"
          placeholder="e.g. Treat the 'Division' column as the department, not 'Grp3'. The cost centre codes in column F actually mean the brand."
          buttonLabel="Redo the dataset"
        />

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Job title</TableHead>
                <TableHead>Function</TableHead>
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
                  <TableCell className="text-muted-foreground">
                    {r.departmentAsStated || <Missing />}
                  </TableCell>
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
                  <TableCell className="text-right tabular-nums">{r.fte.toFixed(2)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.salary === null ? <Missing /> : currency(r.salary)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.annualCost > 0 ? currency(r.annualCost) : <Missing />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </main>
    </div>
  );
}

/** An empty cell that says it is empty, rather than looking like a zero. */
function Missing() {
  return <span className="text-xs text-muted-foreground">not stated</span>;
}
