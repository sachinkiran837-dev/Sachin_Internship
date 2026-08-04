import { notFound } from "next/navigation";
import {
  getActiveScenario,
  getBaselinePositions,
  getBaselineRootId,
  getBusinessContext,
  getIssues,
  getOrg,
} from "@/db/repo";
import { currency } from "@/lib/format/currency";
import { computeMetrics } from "@/lib/metrics/diagnostics";
import { buildHypotheses } from "@/lib/hypothesis/build";
import { buildBoardPack } from "@/lib/report/boardPack";
import { OrgNav } from "@/components/OrgNav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const ESTIMATE_CLASS_LABEL: Record<string, string> = {
  computed: "Computed",
  estimated: "Estimated",
  "requires-data": "Requires data",
};

/**
 * i1-board-pack-synthesis: the pack the client keeps. Deliberately short of
 * the full answer — depth belongs on the consultant-briefing page. Every
 * figure here is pulled from lib/report/boardPack.ts, never recomputed on
 * this page.
 */
export default async function BoardPackPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const org = await getOrg(orgId);
  if (!org) notFound();

  const baseline = await getBaselinePositions(orgId);
  const rootId = getBaselineRootId(baseline);
  const scenario = await getActiveScenario(orgId);
  const positions = scenario?.positions ?? baseline;
  const business = await getBusinessContext(orgId);
  const issues = await getIssues(orgId);

  const metrics = computeMetrics(positions, rootId, issues);
  const { hypotheses } = buildHypotheses(positions, rootId, business, issues);
  const pack = buildBoardPack(positions, rootId, business, metrics, hypotheses, true);

  return (
    <div className="flex flex-1 flex-col">
      <OrgNav orgId={orgId} active="board-pack" />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-8">
        <div>
          <p className="eyebrow">
            <span className="eyebrow-dot" aria-hidden />
            Board pack
          </p>
          <h1 className="mt-1 text-2xl">{currency(pack.headlineAmount)}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed">{pack.judgmentSentence}</p>
          <p className="mt-2 text-xs text-muted-foreground">{pack.standingCaveat}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>The value stack</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {pack.valueTiles.length === 0 && (
              <p className="text-sm text-muted-foreground">No priced opportunity reconciles to a real figure on this establishment yet.</p>
            )}
            {pack.valueTiles.map((t) => (
              <div key={t.estimateClass} className="rounded-lg border p-4">
                <Badge variant="secondary">{ESTIMATE_CLASS_LABEL[t.estimateClass]}</Badge>
                <p className="mt-2 text-xl font-semibold">{currency(t.amount)}</p>
                <p className="text-xs text-muted-foreground">
                  {t.opportunityCount} opportunit{t.opportunityCount === 1 ? "y" : "ies"} — net of transition cost
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Where the value is</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            {pack.whereTheValueIs.map((h) => (
              <div key={h.id} className="border-b pb-3 last:border-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <Badge variant={h.confidenceGrade === "high" ? "default" : "secondary"}>{h.confidenceGrade} confidence</Badge>
                  <p className="font-medium">{h.title}</p>
                </div>
                <p className="mt-1 text-muted-foreground">{h.thinking}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ask: {h.provokingQuestions?.[0]}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{pack.standingCaveat}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How you compare</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {pack.howYouCompare.length === 0 && (
              <p className="text-muted-foreground">Nothing on this establishment currently sits far enough outside its peer band to show here.</p>
            )}
            {pack.howYouCompare.map(({ reading, cohort }) => (
              <div key={reading.metric}>
                <p className="font-medium">
                  {reading.label}: {reading.unit === "ratio" ? `${(reading.value * 100).toFixed(0)}%` : reading.value.toFixed(1)} —{" "}
                  {reading.verdict}
                </p>
                <p className="text-xs text-muted-foreground">
                  Peer band {reading.unit === "ratio" ? `${((reading.bandMin ?? 0) * 100).toFixed(0)}-${((reading.bandMax ?? 0) * 100).toFixed(0)}%` : `${reading.bandMin}-${reading.bandMax}`}, {cohort.label}
                  {reading.provisional ? " (provisional cohort)" : ""}. {reading.denominatorBasis}.
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>The protection story</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>{pack.protectionStory.statement}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Every scenario this pack draws on was tested with these roles held — a scenario that touches one is blocked, not flagged.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recommended next steps</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {pack.nextSteps.map((phase, i) => (
              <div key={phase.id} className="flex gap-3">
                <Badge variant="secondary" className="h-fit">{i + 1}</Badge>
                <div>
                  <p className="font-medium">{phase.label}</p>
                  <p className="text-muted-foreground">{phase.milestone}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="text-xs text-muted-foreground">
          <p>{pack.sourceCitation}</p>
          <p>{pack.preparedBy}</p>
        </div>
      </main>
    </div>
  );
}
