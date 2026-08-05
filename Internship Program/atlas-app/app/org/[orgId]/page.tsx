import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getBaselinePositions,
  getIngestPlan,
  getIssues,
  getNotes,
  getOrg,
  getStructureVerification,
  hasSourceBlobs,
} from "@/db/repo";
import { OrgNav } from "@/components/OrgNav";
import { StructureCheck } from "@/components/ingest/StructureCheck";
import { PlanReport } from "@/components/ingest/PlanReport";
import { IngestNotes } from "@/components/ingest/IngestNotes";
import { IssueGroup } from "@/components/ingest/IssueGroup";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/**
 * The confirm screen shows only what Atlas is flagging about this data — never
 * a preview of the data itself. The positions, the completeness stats, the
 * per-file breakdown all have a home already: the canonical table and the
 * map. Repeating them here just gives a reader two places to check when one
 * of them is wrong. This screen exists to answer one question — "does Atlas
 * need me before I go on?" — and a clean establishment should answer it in
 * one sentence.
 */
export default async function OrgConfirmPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const org = await getOrg(orgId);
  if (!org) notFound();

  const all = await getBaselinePositions(orgId);
  const positions = all.filter((p) => !p.synthetic);
  const issues = await getIssues(orgId);
  const plan = await getIngestPlan(orgId);
  const notes = await getNotes(orgId);
  const canReread = await hasSourceBlobs(orgId);
  const structureCheck = await getStructureVerification(orgId);

  const conversions = issues.filter((i) => i.kind === "conversion");
  const unmapped = issues.filter((i) => i.kind === "unmapped_column");
  const orphans = issues.filter((i) => i.kind === "orphan");
  const duplicates = issues.filter((i) => i.kind === "duplicate");
  const lowConfidence = issues.filter((i) => i.kind === "low_confidence");
  // A conversion note isn't itself something to review — it's a record of
  // what Atlas did to the file. A file Atlas *couldn't* use is the
  // exception: it's left unresolved precisely because it's a gap.
  const unusedFiles = conversions.filter((i) => !i.resolved);
  const reviewable = issues.filter((i) => i.kind !== "conversion");
  const questions = notes.filter((n) => n.kind === "question");

  const structureDivergent = structureCheck.claimed > 0 && structureCheck.checked !== structureCheck.verified;
  const planFlagged =
    !!org.ingestContext?.trim() && (plan === null || plan.source !== "ai" || (plan?.warnings.length ?? 0) > 0);

  const hasIssues =
    unusedFiles.length > 0 ||
    reviewable.length > 0 ||
    questions.length > 0 ||
    structureDivergent ||
    planFlagged;

  return (
    <div className="flex flex-1 flex-col">
      <OrgNav orgId={orgId} active="confirm" />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{org.name}</h1>
            <p className="text-sm text-muted-foreground">
              {positions.length} positions · {org.anonymized ? "anonymised" : "not anonymised"}
            </p>
          </div>
          <Link href={`/org/${orgId}/map`}>
            <Button>Open establishment map</Button>
          </Link>
        </div>

        {!hasIssues ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No issues — every file was used, every row mapped cleanly and every reporting line
              resolved.
            </CardContent>
          </Card>
        ) : (
          <>
            {(unusedFiles.length > 0 || reviewable.length > 0) && (
              <Card>
                <CardContent className="flex flex-col gap-4 pt-6 text-sm">
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
                    <IssueGroup
                      title="Orphan records (no resolvable manager)"
                      tone="secondary"
                      items={orphans}
                    />
                  )}
                  {lowConfidence.length > 0 && (
                    <IssueGroup title="Low-confidence inferences" tone="outline" items={lowConfidence} />
                  )}
                </CardContent>
              </Card>
            )}

            <StructureCheck verification={structureCheck} />
            <PlanReport context={org.ingestContext ?? ""} plan={plan} />

            <IngestNotes orgId={orgId} notes={notes} canReread={canReread} />
          </>
        )}
      </main>
    </div>
  );
}
