import { notFound } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Check } from "lucide-react";
import { getBaselinePositions, getIssues, getOrg } from "@/db/repo";
import { OrgNav } from "@/components/OrgNav";
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

  const positions = await getBaselinePositions(orgId);
  const issues = await getIssues(orgId);

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

        {conversions.length > 0 && (
          <div className="rounded-md border border-primary/30 bg-accent/40 px-4 py-3">
            <p className="eyebrow mb-2">
              <span className="eyebrow-dot" aria-hidden />
              {conversions.length > 1 ? "How these files were bound together" : "Source conversion"}
            </p>
            <p className="text-sm text-foreground">{conversions[0].detail}</p>

            {conversions.length > 1 && (
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
                      {new Intl.NumberFormat("en-AU", {
                        style: "currency",
                        currency: "AUD",
                        maximumFractionDigits: 0,
                      }).format(p.cost)}
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

function IssueGroup({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "destructive" | "secondary" | "outline";
  items: { id: string; detail: string }[];
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Badge variant={tone}>{items.length}</Badge>
        <span className="font-medium">{title}</span>
      </div>
      <ul className="flex flex-col gap-1 pl-1 text-muted-foreground">
        {items.map((i) => (
          <li key={i.id}>{i.detail}</li>
        ))}
      </ul>
    </div>
  );
}
