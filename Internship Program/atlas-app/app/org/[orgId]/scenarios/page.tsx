import { notFound } from "next/navigation";
import Link from "next/link";
import { getBaselinePositions, getOrg, listScenarios } from "@/db/repo";
import { compareScenarios } from "@/lib/scenario/compare";
import { OrgNav } from "@/components/OrgNav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createScenarioAction } from "@/app/actions/scenario";

export const dynamic = "force-dynamic";

function currency(n: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);
}

function delta(n: number, unit = ""): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${unit === "$" ? currency(n) : n.toFixed(unit ? 1 : 0)}${unit && unit !== "$" ? unit : ""}`;
}

export default async function ScenariosPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const org = await getOrg(orgId);
  if (!org) notFound();

  const baseline = await getBaselinePositions(orgId);
  const scenarios = await listScenarios(orgId);
  const { baselineMetrics, comparisons } = compareScenarios(
    baseline,
    scenarios.map((s) => ({ id: s.id, name: s.name, positions: s.positions }))
  );

  const createWithOrgId = createScenarioAction.bind(null, orgId);

  return (
    <div className="flex flex-1 flex-col">
      <OrgNav orgId={orgId} active="scenarios" />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Baseline</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Headcount" value={String(baselineMetrics.headcount)} />
            <Stat label="Cost" value={currency(baselineMetrics.totalCost)} />
            <Stat label="Layers" value={String(baselineMetrics.layers)} />
            <Stat label="Avg span" value={baselineMetrics.averageSpan.toFixed(1)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Start a new scenario</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createWithOrgId} className="flex gap-2">
              <Input name="name" placeholder="e.g. Flatten clinical operations" />
              <Button type="submit">Create</Button>
            </form>
          </CardContent>
        </Card>

        {comparisons.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Compare scenarios against baseline</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {comparisons.map((c) => (
                <Link
                  key={c.scenarioId}
                  href={`/org/${orgId}/scenarios/${c.scenarioId}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="flex gap-3 text-muted-foreground">
                    <span>headcount {delta(c.delta.headcountDelta)}</span>
                    <span>cost {delta(c.delta.costDelta, "$")}</span>
                    <span>layers {delta(c.delta.layersDelta)}</span>
                    {c.delta.safeStaffingBreach && <Badge variant="destructive">safe-staffing flag</Badge>}
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
