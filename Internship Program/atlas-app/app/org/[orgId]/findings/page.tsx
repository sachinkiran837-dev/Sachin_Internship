import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getActiveScenario,
  getBaselinePositions,
  getBaselineRootId,
  getBusinessContext,
  getOrg,
} from "@/db/repo";
import { buildFindingsResult, generateNarrative } from "@/lib/findings/generate";
import { buildHypotheses, type Hypothesis } from "@/lib/hypothesis/build";
import { hasBusinessContext } from "@/lib/hypothesis/context";
import type { DiagnosticMetrics } from "@/lib/graph/types";
import { OrgNav } from "@/components/OrgNav";
import { HypothesisCard } from "@/components/hypothesis/HypothesisCard";
import { FunctionTable } from "@/components/analysis/FunctionTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

/**
 * What we think is happening, what to do about it, and what it is worth.
 *
 * Everything on this page is computed before it renders — the hypotheses, the
 * comparisons, the prizes. Only the paragraph that introduces them is drafted,
 * and it arrives after the rest. That ordering is not a nicety: drafting the
 * summary took seven seconds against a thousand positions, and a page that
 * spends seven seconds on its least important element will sooner or later hit
 * the host's request ceiling and return nothing at all.
 */
export default async function FindingsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const org = await getOrg(orgId);
  if (!org) notFound();

  const baseline = await getBaselinePositions(orgId);
  const rootId = getBaselineRootId(baseline);
  const scenario = await getActiveScenario(orgId);
  const positions = scenario?.positions ?? baseline;
  const business = await getBusinessContext(orgId);

  const { hypotheses, analysis, metrics, wouldUnlock, method } = buildHypotheses(
    positions,
    rootId,
    business
  );
  const structural = buildFindingsResult(metrics);

  const tested = hypotheses.filter((h) => h.verdict !== null);
  const found = hypotheses.filter((h) => h.verdict === null && h.strength !== "needs-input");
  const gaps = hypotheses.filter((h) => h.strength === "needs-input");

  return (
    <div className="flex flex-1 flex-col">
      <OrgNav orgId={orgId} active="findings" />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-8">
        <div>
          <p className="eyebrow">
            <span className="eyebrow-dot" aria-hidden />
            Findings {scenario ? `— ${scenario.name}` : "— baseline"}
          </p>
          <h1 className="mt-1 text-2xl">What we think is happening here</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Every hypothesis below carries the same three parts: what the data suggests is
            happening, what to do about it, and what you get if you do. The comparisons are against
            this organisation&rsquo;s own median unit — never an outside benchmark — so every figure
            can be checked against the table further down this page.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<SummarySkeleton />}>
              <Summary metrics={metrics} hypotheses={hypotheses} />
            </Suspense>
          </CardContent>
        </Card>

        {!hasBusinessContext(business) && (
          <div className="rounded-lg border border-primary/30 bg-accent/30 px-4 py-3">
            <p className="eyebrow mb-1.5">
              <span className="eyebrow-dot" aria-hidden />
              Hypothesis layer empty
            </p>
            <p className="text-sm">
              Atlas is working from your files alone. Tell it what the business earns, what
              you&rsquo;re trying to reach and what you already suspect, and it will rank functions
              on revenue per head, measure every play against your target, and test each suspicion
              against the establishment. It is asked for on the{" "}
              <Link href="/" className="font-medium underline underline-offset-4">
                upload screen
              </Link>
              , above the file picker.
            </p>
          </div>
        )}

        {tested.length > 0 && (
          <Section
            title="What you told us, tested"
            blurb="Your own hypotheses, put against the establishment. An unsupported one is the most valuable result on this page — it stops a redesign being built on it."
          >
            {tested.map((h) => (
              <HypothesisCard key={h.id} orgId={orgId} hypothesis={h} />
            ))}
          </Section>
        )}

        {found.length > 0 ? (
          <Section
            title={`What the data suggests (${found.length})`}
            blurb={method}
          >
            {found.map((h) => (
              <HypothesisCard key={h.id} orgId={orgId} hypothesis={h} />
            ))}
          </Section>
        ) : (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Nothing in this establishment sits far enough outside its own norms to raise as a
              hypothesis. {analysis.primary.limitation ?? ""}
            </CardContent>
          </Card>
        )}

        <FunctionTable comparison={analysis.primary} choice={analysis.choice} />

        {gaps.length > 0 && (
          <Section
            title="What Atlas will not guess"
            blurb="Real questions Atlas can see the shape of but cannot size from an establishment file alone."
          >
            {gaps.map((h) => (
              <HypothesisCard key={h.id} orgId={orgId} hypothesis={h} />
            ))}
          </Section>
        )}

        {wouldUnlock.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>What one more line from you would unlock</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <ul className="flex flex-col gap-2">
                {wouldUnlock.map((u, i) => (
                  <li key={i} className="flex gap-2 text-muted-foreground">
                    <span aria-hidden>·</span>
                    <span>{u}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">
                All of this is asked for on the upload screen. Supplying it means re-reading the
                files with it in hand.
              </p>
            </CardContent>
          </Card>
        )}

        {/* The structural checks, kept whole and kept below. These are the
            things that are true of the chart regardless of what anyone thinks
            is going on — a reader who disagrees with every hypothesis above
            should still be able to see them. */}
        <Card>
          <CardHeader>
            <CardTitle>What the structure flags on its own</CardTitle>
            <p className="text-sm text-muted-foreground">
              Computed from the chart alone, with no interpretation on top.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {structural.findings.map((f, i) => (
              <div key={f.id} className="flex gap-3">
                <Badge variant="secondary" className="h-fit">
                  {i + 1}
                </Badge>
                <div>
                  <p className="font-medium">{f.headline}</p>
                  <p className="text-muted-foreground">{f.soWhat}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Based on {f.evidenceIds.map(evidenceLabel).join(", ")}.
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{blurb}</p>
      </div>
      {children}
    </section>
  );
}

async function Summary({
  metrics,
  hypotheses,
}: {
  metrics: DiagnosticMetrics;
  hypotheses: Hypothesis[];
}) {
  const { narrative } = await generateNarrative(metrics, hypotheses);
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
