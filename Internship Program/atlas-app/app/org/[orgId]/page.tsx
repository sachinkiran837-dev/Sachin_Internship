import { currency } from "@/lib/format/currency";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Check } from "lucide-react";
import {
  getBaselinePositions,
  getIngestPlan,
  getIssues,
  getNotes,
  getOrg,
  getSourceFiles,
  getStructureVerification,
  hasSourceBlobs,
} from "@/db/repo";
import { UNCLASSIFIED } from "@/lib/graph/types";
import { OrgNav } from "@/components/OrgNav";
import { StructureCheck } from "@/components/ingest/StructureCheck";
import { SourceDataReport } from "@/components/ingest/SourceDataReport";
import { PlanReport } from "@/components/ingest/PlanReport";
import { IngestNotes } from "@/components/ingest/IngestNotes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function OrgConfirmPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const org = await getOrg(orgId);
  if (!org) notFound();

  const all = await getBaselinePositions(orgId);
  // Heading nodes added to consolidate the map are structure, not roles. They
  // are excluded here for the same reason they are excluded from the metrics:
  // a coverage figure that counted them would report a missing cost on a box
  // that was never a job.
  const positions = all.filter((p) => !p.synthetic);
  const issues = await getIssues(orgId);
  const sourceFiles = await getSourceFiles(orgId);
  const plan = await getIngestPlan(orgId);
  const notes = await getNotes(orgId);
  const canReread = await hasSourceBlobs(orgId);
  const structureCheck = await getStructureVerification(orgId);

  // How complete the establishment actually is, field by field. The headline
  // count says how many rows arrived; this says how much of each row is
  // usable, which is what decides whether a cost figure downstream means
  // anything.
  const statusSupplied = sourceFiles.some((f) => f.contributedFields.includes("status"));
  const coverage = [
    {
      label: "Fully-loaded cost",
      have: positions.filter((p) => p.cost > 0).length,
      note: "the rest model as $0, which understates every saving",
    },
    {
      label: "Reporting line",
      have: positions.filter((p) => p.managerId !== null).length,
      note: "the top role has none by definition",
    },
    {
      label: "Department",
      have: positions.filter((p) => p.department !== UNCLASSIFIED).length,
      note: "needed to group and consolidate teams",
    },
    {
      label: "Employment status",
      have: statusSupplied ? positions.length : 0,
      note: statusSupplied
        ? `${positions.filter((p) => p.status === "vacant").length} vacant, ${positions.filter((p) => p.status === "contingent").length} contingent`
        : "no status column arrived — every role is assumed filled",
    },
  ];

  const conversions = issues.filter((i) => i.kind === "conversion");
  const unmapped = issues.filter((i) => i.kind === "unmapped_column");
  const orphans = issues.filter((i) => i.kind === "orphan");
  const duplicates = issues.filter((i) => i.kind === "duplicate");
  const lowConfidence = issues.filter((i) => i.kind === "low_confidence");
  // A conversion note isn't something to review — it's a record of what
  // Atlas did to the file, so it doesn't count toward "no ingest issues".
  // A file Atlas *couldn't* use is the exception: it's left unresolved
  // precisely because it's a gap, and claiming a clean ingest alongside a
  // refused file would be the app contradicting itself on one screen.
  const unusedFiles = conversions.filter((i) => !i.resolved);
  const reviewable = issues.filter((i) => i.kind !== "conversion");

  return (
    <div className="flex flex-1 flex-col">
      <OrgNav orgId={orgId} active="confirm" />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{org.name}</h1>
            <p className="text-sm text-muted-foreground">
              Ingested from {org.sourceFilename} · {positions.length} positions ·{" "}
              {org.anonymized ? "anonymised" : "not anonymised"}
            </p>
          </div>
          <Link href={`/org/${orgId}/map`}>
            <Button>Open establishment map</Button>
          </Link>
        </div>

        {/* Before anything else on this screen, because everything else on it
            is downstream of these. */}
        <IngestNotes orgId={orgId} notes={notes} canReread={canReread} />

        {conversions.length > 0 && (
          <div className="rounded-md border border-primary/30 bg-accent/40 px-4 py-3">
            <p className="eyebrow mb-2">
              <span className="eyebrow-dot" aria-hidden />
              {conversions.length > 1 ? "How these files were bound together" : "Source conversion"}
            </p>
            <p className="text-sm text-foreground">{conversions[0].detail}</p>

            {/* The per-file lines live in the source report below once one
                exists; this list is the fallback for establishments ingested
                before that was recorded. */}
            {sourceFiles.length === 0 && conversions.length > 1 && (
              <ul className="mt-2.5 flex flex-col gap-1.5 border-t border-primary/20 pt-2.5">
                {conversions.slice(1).map((c) => {
                  const [filename, ...rest] = c.detail.split(" — ");
                  return (
                    <li key={c.id} className="flex gap-2 text-sm">
                      {/* An unusable file stays unresolved on ingest, so this
                          is the one that needs the reader's eye. */}
                      {c.resolved ? (
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      ) : (
                        <AlertTriangle
                          className="mt-0.5 size-4 shrink-0 text-amber-600"
                          aria-hidden
                        />
                      )}
                      <span>
                        <span className="font-medium">{filename}</span>
                        <span className="text-muted-foreground"> — {rest.join(" — ")}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <PlanReport context={org.ingestContext ?? ""} plan={plan} />

        {sourceFiles.length > 0 && <SourceDataReport files={sourceFiles} />}

        {/* After the per-file report, because it only means anything once the
            reader knows which file was used as the chart — and before the
            completeness bars, because a structure that doesn't match the
            client's own chart makes every figure below it beside the point. */}
        <StructureCheck verification={structureCheck} />

        <Card>
          <CardHeader>
            <CardTitle>How complete this establishment is</CardTitle>
            <p className="text-sm text-muted-foreground">
              {positions.length.toLocaleString()} positions arrived. This is how much of each one
              is usable — a redesign is only as good as the fields underneath it.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {coverage.map((c) => {
              const pct = positions.length === 0 ? 0 : (c.have / positions.length) * 100;
              return (
                <div key={c.label}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{c.label}</span>
                    <span className="text-sm text-muted-foreground">
                      {c.have.toLocaleString()} of {positions.length.toLocaleString()} ·{" "}
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={`h-full ${pct >= 90 ? "bg-primary" : pct >= 50 ? "bg-amber-500" : "bg-destructive"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{c.note}</p>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {reviewable.length === 0 && unusedFiles.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No ingest issues — every file was used, every row mapped cleanly and every reporting
              line resolved.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Confirm before treating this as the baseline</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              {unusedFiles.length > 0 && (
                <IssueGroup
                  title="Files that contributed nothing"
                  tone="destructive"
                  items={unusedFiles}
                />
              )}
              {unmapped.length > 0 && (
                <IssueGroup title="Unmapped columns" tone="destructive" items={unmapped} />
              )}
              {duplicates.length > 0 && (
                <IssueGroup title="Duplicate position IDs" tone="secondary" items={duplicates} />
              )}
              {orphans.length > 0 && (
                <IssueGroup title="Orphan records (no resolvable manager)" tone="secondary" items={orphans} />
              )}
              {lowConfidence.length > 0 && (
                <IssueGroup title="Low-confidence inferences" tone="outline" items={lowConfidence} />
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Positions ({positions.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.displayName}</TableCell>
                    <TableCell>{p.title}</TableCell>
                    <TableCell>{p.department}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === "filled" ? "secondary" : "outline"}>
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {currency(p.cost)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

/**
 * The shape of a message with its specifics removed, so two reports of the
 * same problem about two different people compare equal.
 *
 * Quoted names, parenthesised asides and numbers are what vary between one
 * orphan and the next; everything left is the problem itself.
 */
function shape(detail: string): string {
  return detail
    .replace(/"[^"]*"/g, '""')
    .replace(/\([^)]*\)/g, "()")
    .replace(/\b\d[\d,.]*\b/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One line per kind of problem, not one per occurrence.
 *
 * Four hundred identical orphan messages are not four hundred things to read —
 * they are one thing, four hundred times, and printing them all is how a
 * reviewer learns to scroll past this card instead of reading it. The first of
 * each kind is shown in full, because the specifics in it are a worked example
 * of the rest.
 */
function condense(items: { id: string; detail: string }[]) {
  const groups = new Map<string, { id: string; detail: string; more: number }>();

  for (const item of items) {
    const key = shape(item.detail);
    const existing = groups.get(key);
    if (existing) existing.more++;
    else groups.set(key, { id: item.id, detail: item.detail, more: 0 });
  }

  return [...groups.values()];
}

function IssueGroup({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "destructive" | "secondary" | "outline";
  items: { id: string; detail: string }[];
}) {
  const condensed = condense(items);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge variant={tone}>{items.length}</Badge>
        <span className="font-medium">{title}</span>
        {condensed.length < items.length && (
          <span className="text-xs text-muted-foreground">
            {condensed.length} distinct {condensed.length === 1 ? "kind" : "kinds"}
          </span>
        )}
      </div>
      <ul className="flex flex-col gap-1.5 pl-1 text-muted-foreground">
        {condensed.map((i) => (
          <li key={i.id}>
            {i.detail}
            {i.more > 0 && (
              <span className="ml-1.5 whitespace-nowrap rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
                +{i.more.toLocaleString()} more like this
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
