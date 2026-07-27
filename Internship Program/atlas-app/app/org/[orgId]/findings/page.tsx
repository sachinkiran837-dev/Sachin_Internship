import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getActiveScenario, getBaselinePositions, getBaselineRootId, getOrg } from "@/db/repo";
import { computeMetrics } from "@/lib/metrics/diagnostics";
import { buildFindingsResult, generateNarrative } from "@/lib/findings/generate";
import type { DiagnosticMetrics } from "@/lib/graph/types";
import { OrgNav } from "@/components/OrgNav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

/**
 * The findings are computed; only the paragraph that introduces them is
 * drafted. So the page renders the findings straight away and lets the
 * summary arrive after — which is also what stops this screen failing
 * outright. Drafting the summary took seven seconds against a thousand
 * positions, and a server-rendered page that spends seven seconds on its
 * least important element will sooner or later hit the host's request
 * ceiling and return nothing at all.
 */
export default async function FindingsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const org = await getOrg(orgId);
  if (!org) notFound();

  const baseline = await getBaselinePositions(orgId);
  const rootId = getBaselineRootId(baseline);
  const scenario = await getActiveScenario(orgId);
  const positions = scenario?.positions ?? baseline;
  const metrics = computeMetrics(positions, rootId);
  const result = buildFindingsResult(metrics);

  return (
    <div className="flex flex-1 flex-col">
      <OrgNav orgId={orgId} active="findings" />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-8">
        <h1 className="text-xl font-semibold">
          Findings {scenario ? `— ${scenario.name}` : "— baseline"}
        </h1>

        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<SummarySkeleton />}>
              <Summary metrics={metrics} />
            </Suspense>
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
                    Based on {f.evidenceIds.map(evidenceLabel).join(", ")}.
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

async function Summary({ metrics }: { metrics: DiagnosticMetrics }) {
  const { narrative } = await generateNarrative(metrics);
  return <p className="text-sm leading-relaxed">{narrative}</p>;
}

function SummarySkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <div className="h-3.5 w-full animate-pulse rounded bg-secondary" />
      <div className="h-3.5 w-11/12 animate-pulse rounded bg-secondary" />
      <div className="h-3.5 w-4/5 animate-pulse rounded bg-secondary" />
    </div>
  );
}

/**
 * Findings carry the metric keys they were derived from so the read stays
 * traceable. Those keys are internal identifiers, so they're named in
 * business terms here rather than shown raw.
 */
const EVIDENCE_LABELS: Record<string, string> = {
  protectedByTier: "protected and governance roles",
  headcount: "headcount",
  totalFte: "contracted FTE",
  contingentCount: "agency and contingent positions",
  totalCost: "fully-loaded cost",
  layers: "management layers",
  averageSpan: "average span of control",
  "thin-spans": "spans below the healthy range",
  "wide-spans": "spans above the healthy range",
  "single-report-chains": "single-report reporting lines",
  "vacant-manager": "vacant roles still carrying a team",
};

function evidenceLabel(id: string): string {
  return EVIDENCE_LABELS[id] ?? id.replace(/-/g, " ");
}
