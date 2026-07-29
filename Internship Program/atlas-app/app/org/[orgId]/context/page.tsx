import { currency } from "@/lib/format/currency";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { getBaselinePositions, getBaselineRootId, getBusinessContext, getOrg } from "@/db/repo";
import { unitNames } from "@/lib/analysis/functions";
import { hasBusinessContext, hasStructuredFacts, totalRevenue } from "@/lib/hypothesis/context";
import { OrgNav } from "@/components/OrgNav";
import { HypothesisForm } from "@/components/hypothesis/HypothesisForm";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * The hypothesis layer and everything Atlas read out of it, side by side.
 *
 * The reading is always shown back, and always with the client's own sentence
 * next to it. A figure extracted from prose is about to be divided by a
 * headcount and put in front of a board, and the only defence against that
 * going wrong is that the person who wrote the sentence can see what was made
 * of it. Anything Atlas could not attach to a real part of the organisation is
 * listed too — silently dropping half of what someone wrote is the fastest way
 * to lose their trust in the rest.
 */

export default async function BusinessContextPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const org = await getOrg(orgId);
  if (!org) notFound();

  const business = await getBusinessContext(orgId);
  const positions = await getBaselinePositions(orgId);
  const units = unitNames(positions, getBaselineRootId(positions));
  const group = totalRevenue(business);

  return (
    <div className="flex flex-1 flex-col">
      <OrgNav orgId={orgId} active="context" />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-8">
        <div>
          <p className="eyebrow">
            <span className="eyebrow-dot" aria-hidden />
            Hypothesis layer
          </p>
          <h1 className="mt-1 text-2xl">What Atlas knows about the business</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your establishment files describe the structure. They cannot describe what it is for.
            Everything on this page is something a person told Atlas, kept separate from everything
            it computed, and quoted back word for word wherever it produced a figure.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <HypothesisForm orgId={orgId} business={business} />
          </CardContent>
        </Card>

        {hasBusinessContext(business) && (
          <Card>
            <CardHeader>
              <CardTitle>What Atlas read out of it</CardTitle>
              <p className="text-sm text-muted-foreground">
                {hasStructuredFacts(business)
                  ? "Each of these is used on the Findings screen. If any of it is wrong, correct the words above rather than working around it."
                  : "Nothing in what you wrote could be turned into a figure or a claim to test. The findings are computed from your files alone."}
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-6 text-sm">
              {business.sector && (
                <Group title="What this organisation does">
                  <p className="text-muted-foreground">{business.sector}</p>
                </Group>
              )}

              {business.revenue.length > 0 && (
                <Group
                  title={`Revenue (${business.revenue.length})`}
                  note={
                    group !== null
                      ? `${currency(group)} in total across what you supplied. Revenue per head and labour as a share of revenue are computed from these on the Findings screen.`
                      : undefined
                  }
                >
                  <ul className="flex flex-col divide-y rounded-md border">
                    {business.revenue.map((r, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-x-2 px-3 py-2">
                        <span className="font-medium">{r.unit ?? "Whole organisation"}</span>
                        {r.period && (
                          <Badge variant="outline" className="font-normal">
                            {r.period}
                          </Badge>
                        )}
                        <span className="ml-auto font-semibold">{currency(r.amount)}</span>
                        <span className="w-full text-xs text-muted-foreground">
                          From your words: &ldquo;{r.statedAs}&rdquo;
                        </span>
                      </li>
                    ))}
                  </ul>
                </Group>
              )}

              {business.targets.length > 0 && (
                <Group
                  title={`What you're aiming for (${business.targets.length})`}
                  note="Every play Atlas finds is measured against this rather than presented as one option among ten."
                >
                  <ul className="flex flex-col divide-y rounded-md border">
                    {business.targets.map((t, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-x-2 px-3 py-2">
                        <Badge variant="secondary" className="font-normal">
                          {t.measure}
                        </Badge>
                        <span className="font-medium">
                          {t.amount === null
                            ? "no figure stated"
                            : t.measure === "cost"
                              ? currency(t.amount)
                              : t.amount.toLocaleString()}
                        </span>
                        {t.horizon && (
                          <span className="text-xs text-muted-foreground">{t.horizon}</span>
                        )}
                        <span className="w-full text-xs text-muted-foreground">
                          From your words: &ldquo;{t.statedAs}&rdquo;
                        </span>
                      </li>
                    ))}
                  </ul>
                </Group>
              )}

              {business.beliefs.length > 0 && (
                <Group
                  title={`What you suspect (${business.beliefs.length})`}
                  note="Each of these is tested against the establishment on the Findings screen — including the ones the data contradicts."
                >
                  <ul className="flex flex-col divide-y rounded-md border">
                    {business.beliefs.map((b, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-x-2 px-3 py-2">
                        <Badge variant="outline" className="font-normal">
                          {b.about}
                        </Badge>
                        {b.unit && <span className="text-xs font-medium">{b.unit}</span>}
                        <span className="w-full">&ldquo;{b.statedAs}&rdquo;</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={`/org/${orgId}/findings`}
                    className="mt-2 inline-flex w-fit items-center rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                  >
                    See how each one held up
                  </Link>
                </Group>
              )}

              {business.constraints.length > 0 && (
                <Group title={`Off limits (${business.constraints.length})`}>
                  <ul className="flex flex-col gap-1.5 text-muted-foreground">
                    {business.constraints.map((c, i) => (
                      <li key={i}>
                        {c.unit && <span className="font-medium text-foreground">{c.unit}: </span>}
                        &ldquo;{c.statedAs}&rdquo;
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Recorded and shown alongside every play. Atlas does not enforce these
                    automatically — statutory, governance and safety-critical roles are the ones it
                    blocks at the point a change is applied, and those come from the protected-roles
                    rules rather than from here.
                  </p>
                </Group>
              )}

              {business.unmatched.length > 0 && (
                <Group title={`What Atlas could not use (${business.unmatched.length})`}>
                  <ul className="flex flex-col gap-2">
                    {business.unmatched.map((u, i) => (
                      <li key={i} className="flex gap-2 text-muted-foreground">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
                        <span>{u}</span>
                      </li>
                    ))}
                  </ul>
                </Group>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>The names Atlas will recognise</CardTitle>
            <p className="text-sm text-muted-foreground">
              Write a figure against one of these and Atlas attaches it. Write it against anything
              else and it is listed as unmatched rather than guessed at — a revenue figure on the
              wrong part of the business is worse than none.
            </p>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {units.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No units were identified in this establishment.
              </p>
            ) : (
              units.map((u) => (
                <Badge key={u} variant="secondary" className="font-normal">
                  {u}
                </Badge>
              ))
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function Group({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="eyebrow mb-1.5">
        <span className="eyebrow-dot" aria-hidden />
        {title}
      </p>
      {note && <p className="mb-2 text-xs text-muted-foreground">{note}</p>}
      {children}
    </div>
  );
}
