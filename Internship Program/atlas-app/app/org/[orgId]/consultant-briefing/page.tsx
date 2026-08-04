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
import { buildHypotheses } from "@/lib/hypothesis/build";
import { buildBriefing } from "@/lib/hypothesis/briefing";
import { analyseAllPlays } from "@/lib/scenario/plays";
import { reconcileValue } from "@/lib/scenario/reconcile";
import { OrgNav } from "@/components/OrgNav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

/**
 * i2-consultant-briefing: the engagement-opening document, deliberately
 * deep. Threads are ranked by lib/hypothesis/briefing.ts's own combined
 * prize-and-prosecutability score, never by dollar value alone.
 */
export default async function ConsultantBriefingPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const org = await getOrg(orgId);
  if (!org) notFound();

  const baseline = await getBaselinePositions(orgId);
  const rootId = getBaselineRootId(baseline);
  const scenario = await getActiveScenario(orgId);
  const positions = scenario?.positions ?? baseline;
  const business = await getBusinessContext(orgId);
  const issues = await getIssues(orgId);

  const { hypotheses } = buildHypotheses(positions, rootId, business, issues);
  const reconciled = reconcileValue(positions, analyseAllPlays(positions, rootId));
  const briefing = buildBriefing(hypotheses, reconciled);

  return (
    <div className="flex flex-1 flex-col">
      <OrgNav orgId={orgId} active="consultant-briefing" />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-8">
        <div>
          <p className="eyebrow">
            <span className="eyebrow-dot" aria-hidden />
            Consultant briefing
          </p>
          <h1 className="mt-1 text-2xl">The threads, ranked, with the pushback already anticipated</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            The tool found these threads. Pulling them is the job — this document exists so you don&rsquo;t walk in cold.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Open on day one</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{briefing.consultationOpener}</CardContent>
        </Card>

        <section className="flex flex-col gap-4">
          {briefing.threads.map((t, i) => (
            <Card key={t.hypothesis.id}>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">#{i + 1}</Badge>
                  <Badge variant={t.hypothesis.confidenceGrade === "high" ? "default" : "secondary"}>
                    {t.hypothesis.confidenceGrade} confidence
                  </Badge>
                  {t.sizing !== null && <Badge variant="outline">{currency(t.sizing)}</Badge>}
                </div>
                <CardTitle className="mt-1">{t.hypothesis.title}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <p>{t.hypothesis.thinking}</p>

                <div>
                  <p className="font-medium">Questions to put in the room</p>
                  <ul className="mt-1 flex flex-col gap-1 text-muted-foreground">
                    {t.hypothesis.provokingQuestions?.map((q, qi) => <li key={qi}>· {q}</li>)}
                  </ul>
                </div>

                <p>
                  <span className="font-medium">Falsifier: </span>
                  <span className="text-muted-foreground">{t.hypothesis.falsifier}</span>
                </p>

                <div className="rounded-lg border p-3">
                  <p className="font-medium">Anticipated pushback</p>
                  <p className="mt-1 text-muted-foreground">{t.pushback.objection}</p>
                  <p className="mt-1">{t.pushback.response}</p>
                </div>

                <p>
                  <span className="font-medium">Data ask, framed as an unlock: </span>
                  <span className="text-muted-foreground">{t.hypothesis.dataAsk}</span>
                </p>
              </CardContent>
            </Card>
          ))}
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Before you draft a scenario from any of this</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{briefing.pressureTestInstruction}</CardContent>
        </Card>
      </main>
    </div>
  );
}
