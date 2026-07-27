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
        <div>
          <h1 className="text-xl font-semibold">
            Findings {scenario ? `— ${scenario.name}` : "— baseline"}
          </h1>
          {/* Provenance stays visible per the house rule, but stated as what
              produced the wording rather than as an internal code path —
              every figure below is computed either way. */}
          <p className="mt-1 text-xs text-muted-foreground">
            {result.source === "ai"
              ? "Wording drafted by AI from figures computed here. Every number is calculated, not generated."
              : "Written directly from the computed figures."}
          </p>
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

/**
 * Findings carry the metric keys they were derived from so the read stays
 * traceable. Those keys are internal identifiers, so they're named in
 * business terms here rather than shown raw.
 */
const EVIDENCE_LABELS: Record<string, string> = {
  protectedByTier: "protected and governance roles",
  headcount: "headcount",
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
