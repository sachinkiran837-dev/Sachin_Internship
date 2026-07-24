import { notFound } from "next/navigation";
import {
  getBaselinePositions,
  getBaselineRootId,
  getScenario,
  listAuditLog,
  getOrg,
} from "@/db/repo";
import { computeDelta, computeMetrics } from "@/lib/metrics/diagnostics";
import { findSafeStaffingBreaches } from "@/lib/scenario/compare";
import { OrgNav } from "@/components/OrgNav";
import { ScenarioMoveForm } from "@/components/scenario/ScenarioMoveForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

function currency(n: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);
}

export default async function ScenarioDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; scenarioId: string }>;
}) {
  const { orgId, scenarioId } = await params;
  const org = await getOrg(orgId);
  const scenario = await getScenario(scenarioId);
  if (!org || !scenario || scenario.orgId !== orgId) notFound();

  const baseline = await getBaselinePositions(orgId);
  const rootId = getBaselineRootId(baseline);
  const baselineMetrics = computeMetrics(baseline, rootId);
  const scenarioMetrics = computeMetrics(scenario.positions, getBaselineRootId(scenario.positions) ?? rootId);
  const breaches = findSafeStaffingBreaches(baseline, scenario.positions);
  const delta = computeDelta(baselineMetrics, scenarioMetrics, breaches);
  const auditLog = await listAuditLog(scenarioId);

  return (
    <div className="flex flex-1 flex-col">
      <OrgNav orgId={orgId} active="scenarios" />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-8">
        <div>
          <h1 className="text-xl font-semibold">{scenario.name}</h1>
          <p className="text-sm text-muted-foreground">
            {scenario.status === "active" ? "Active working scenario" : "Draft scenario"} · created{" "}
            {new Date(scenario.createdAt).toLocaleString()}
          </p>
        </div>

        {delta.safeStaffingBreach && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            Safe-staffing flag: {breaches.length} protected or clinical position
            {breaches.length === 1 ? " was" : "s were"} touched in this scenario.
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Impact vs baseline</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <DeltaStat label="Headcount" baseline={baselineMetrics.headcount} value={scenarioMetrics.headcount} d={delta.headcountDelta} />
            <DeltaStat
              label="Cost"
              baseline={currency(baselineMetrics.totalCost)}
              value={currency(scenarioMetrics.totalCost)}
              d={delta.costDelta}
              unit="$"
            />
            <DeltaStat label="Layers" baseline={baselineMetrics.layers} value={scenarioMetrics.layers} d={delta.layersDelta} />
            <DeltaStat
              label="Avg span"
              baseline={baselineMetrics.averageSpan.toFixed(1)}
              value={scenarioMetrics.averageSpan.toFixed(1)}
              d={delta.averageSpanDelta}
              unit="span"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Model a move</CardTitle>
          </CardHeader>
          <CardContent>
            <ScenarioMoveForm orgId={orgId} scenarioId={scenarioId} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Applied moves ({scenario.moves.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {scenario.moves.length === 0 ? (
              <p className="text-sm text-muted-foreground">No moves applied yet.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {scenario.moves.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 border-b pb-2">
                    <span>{m.description}</span>
                    <Badge variant="outline">{m.kind}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Audit log ({auditLog.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {auditLog.length === 0 ? (
              <p className="text-sm text-muted-foreground">No edits recorded yet.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {auditLog.map((a) => (
                  <li key={a.id} className="border-b pb-2">
                    <span className="text-muted-foreground">{new Date(a.when).toLocaleString()}</span>{" "}
                    — {a.who}: {a.detail}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function DeltaStat({
  label,
  baseline,
  value,
  d,
  unit,
}: {
  label: string;
  baseline: string | number;
  value: string | number;
  d: number;
  unit?: string;
}) {
  const sign = d > 0 ? "+" : "";
  const deltaLabel = unit === "$" ? `${sign}${currency(d)}` : `${sign}${d.toFixed(unit ? 1 : 0)}${unit && unit !== "$" ? ` ${unit}` : ""}`;
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      <p className={`text-xs ${d === 0 ? "text-muted-foreground" : d < 0 ? "text-emerald-600" : "text-amber-600"}`}>
        {deltaLabel} vs baseline ({baseline})
      </p>
    </div>
  );
}
