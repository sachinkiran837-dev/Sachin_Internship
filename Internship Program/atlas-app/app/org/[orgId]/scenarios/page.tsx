import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getBaselinePositions,
  getBaselineRootId,
  getBusinessContext,
  getOrg,
  listScenarios,
} from "@/db/repo";
import { compareScenarios } from "@/lib/scenario/compare";
import { analyseAllPlays } from "@/lib/scenario/plays";
import { OrgNav } from "@/components/OrgNav";
import { PlayCard } from "@/components/scenario/PlayCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
  const rootId = getBaselineRootId(baseline);
  const business = await getBusinessContext(orgId);
  const costTarget = business.targets.find((t) => t.measure === "cost" && t.amount !== null);
  const scenarios = await listScenarios(orgId);
  const { baselineMetrics, comparisons } = compareScenarios(
    baseline,
    scenarios.map((s) => ({ id: s.id, name: s.name, positions: s.positions }))
  );

  // Every play is analysed against the baseline, so the options stay
  // comparable no matter what has already been modelled elsewhere.
  const plays = analyseAllPlays(baseline, rootId);
  const ranked = [...plays].sort(
    (a, b) => b.analysis.projectedSaving - a.analysis.projectedSaving
  );
  const live = ranked.filter((p) => p.analysis.candidates.length > 0);
  const largest = live[0]?.analysis.projectedSaving ?? 0;

  return (
    <div className="flex flex-1 flex-col">
      <OrgNav orgId={orgId} active="scenarios" />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-8">
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

        <section>
          <p className="eyebrow mb-3">
            <span className="eyebrow-dot" aria-hidden />
            Redesign plays
          </p>
          <h2 className="text-2xl">Where the money actually is</h2>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            {`${live.length} of ${plays.length} plays found something to act on in this establishment.`}{" "}
            Each one is analysed against the baseline and priced from this org&apos;s own data —
            open a play to see the arithmetic and the exact roles behind the number before you
            model it.
          </p>

          {live.length > 0 && (
            <p className="mt-3 rounded-md border border-primary/30 bg-accent/40 px-3 py-2 text-sm">
              <span className="font-medium">These are alternative lenses, not a shopping list.</span>{" "}
              They overlap deliberately — the same thin-span manager can appear in several plays —
              so the savings must not be added together. The largest single play here is worth{" "}
              {currency(largest)}.
            </p>
          )}

          {/* Measured against what the client actually said they need, rather
              than presented as ten options of unstated relevance. */}
          {costTarget?.amount != null && live.length > 0 && (
            <p className="mt-2 rounded-md border px-3 py-2 text-sm">
              <span className="font-medium">Against your target.</span> You said:{" "}
              &ldquo;{costTarget.statedAs}&rdquo; The largest single play Atlas can evidence is worth{" "}
              {currency(largest)},{" "}
              {largest >= costTarget.amount
                ? `which reaches ${currency(costTarget.amount)} on its own.`
                : `leaving ${currency(costTarget.amount - largest)} that structure alone does not account for.`}{" "}
              <Link href={`/org/${orgId}/findings`} className="underline underline-offset-4">
                See what that means
              </Link>
              .
            </p>
          )}

          <div className="mt-4 flex flex-col gap-3">
            {ranked.map(({ play, analysis }) => (
              <PlayCard key={play.id} orgId={orgId} play={play} analysis={analysis} />
            ))}
          </div>
        </section>

        {comparisons.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Modelled scenarios ({comparisons.length})</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {comparisons.map((c) => (
                <Link
                  key={c.scenarioId}
                  href={`/org/${orgId}/scenarios/${c.scenarioId}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="flex flex-wrap items-center gap-3 text-muted-foreground">
                    <span>headcount {delta(c.delta.headcountDelta)}</span>
                    <span>cost {delta(c.delta.costDelta, "$")}</span>
                    <span>layers {delta(c.delta.layersDelta)}</span>
                    {c.delta.safeStaffingBreach && (
                      <Badge variant="destructive">safe-staffing flag</Badge>
                    )}
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
