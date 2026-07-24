import { notFound } from "next/navigation";
import Link from "next/link";
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

  const unmapped = issues.filter((i) => i.kind === "unmapped_column");
  const orphans = issues.filter((i) => i.kind === "orphan");
  const duplicates = issues.filter((i) => i.kind === "duplicate");
  const lowConfidence = issues.filter((i) => i.kind === "low_confidence");

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

        {issues.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No ingest issues — every row mapped cleanly and every reporting line resolved.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Confirm before treating this as the baseline</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
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
