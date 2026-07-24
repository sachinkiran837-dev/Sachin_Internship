import { notFound } from "next/navigation";
import { getActiveScenario, getBaselinePositions, getBaselineRootId, getOrg } from "@/db/repo";
import { computeMetrics } from "@/lib/metrics/diagnostics";
import { generateFindings } from "@/lib/findings/generate";
import { OrgNav } from "@/components/OrgNav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function FindingsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const org = await getOrg(orgId);
  if (!org) notFound();

  const baseline = await getBaselinePositions(orgId);
  const rootId = getBaselineRootId(baseline);
  const scenario = await getActiveScenario(orgId);
  const positions = scenario?.positions ?? baseline;
  const metrics = computeMetrics(positions, rootId);
  const result = await generateFindings(metrics);

  return (
    <div className="flex flex-1 flex-col">
      <OrgNav orgId={orgId} active="findings" />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">
            Findings {scenario ? `— ${scenario.name}` : "— baseline"}
          </h1>
          <Badge variant={result.source === "ai" ? "default" : "outline"}>
            {result.source === "ai" ? "AI-generated narrative" : "Deterministic fallback narrative"}
          </Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed">{result.narrative}</p>
          </CardContent>
        </Card>

        {result.findings.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Nothing notable to report against the current thresholds.
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {result.findings.map((f, i) => (
              <Card key={f.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Badge variant="secondary">{i + 1}</Badge>
                    {f.headline}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-sm">
                  <p>{f.soWhat}</p>
                  <p className="text-xs text-muted-foreground">
                    Evidence: {f.evidenceIds.join(", ")}
                  </p>
                  {f.followups.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Follow-up: {f.followups.join(" ")}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
