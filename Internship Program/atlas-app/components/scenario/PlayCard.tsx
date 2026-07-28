"use client";

import { useActionState, useState } from "react";
import { ChevronDown, ShieldCheck, TrendingDown } from "lucide-react";
import { layerPlayAction, runPlayAction, type RunPlayState } from "@/app/actions/scenario";
import type { PlayAnalysis, PlayMeta, SavingNature } from "@/lib/scenario/plays";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const initialState: RunPlayState = { error: null };

function currency(n: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * How the money should be read. A rebase and an avoided hire are not the
 * same thing as a role leaving the establishment, and a client will hold us
 * to the difference — so the distinction is on the card, not in a footnote.
 */
const NATURE_COPY: Record<SavingNature, { label: string; hint: string }> = {
  "cost-out": { label: "Cost out", hint: "Roles leave the establishment; recurring saving." },
  "cost-rebase": {
    label: "Cost rebase",
    hint: "Headcount unchanged — the same work is bought at a lower price.",
  },
  "cost-avoidance": {
    label: "Cost avoidance",
    hint: "Nothing is cut; a hire that would otherwise be needed is avoided.",
  },
};

export interface PlayCardProps {
  orgId: string;
  play: PlayMeta;
  analysis: PlayAnalysis;
  /**
   * Omitted on the Scenarios tab, where each play opens its own scenario so
   * the options stay comparable. Supplied on a scenario's own page, where
   * the play layers onto the redesign already in progress.
   */
  layerOntoScenarioId?: string;
}

export function PlayCard({ orgId, play, analysis, layerOntoScenarioId }: PlayCardProps) {
  const boundAction = layerOntoScenarioId
    ? layerPlayAction.bind(null, orgId, layerOntoScenarioId)
    : runPlayAction.bind(null, orgId);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);
  const [open, setOpen] = useState(false);

  const hasCandidates = analysis.candidates.length > 0;
  const nature = NATURE_COPY[analysis.savingNature];

  return (
    <div
      // Anchored so a hypothesis on the Findings screen can link straight to
      // the play that models it.
      id={play.id}
      className={`scroll-mt-32 rounded-lg border transition-colors ${
        hasCandidates ? "bg-card" : "bg-muted/40"
      }`}
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-normal">
              {play.lens}
            </Badge>
            {hasCandidates && (
              <Badge variant="secondary" className="font-normal">
                {nature.label}
              </Badge>
            )}
          </div>
          <h3 className="text-base font-semibold">{play.name}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{play.question}</p>
          <p className="mt-2 text-sm">{analysis.summary}</p>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          {hasCandidates ? (
            <>
              <div className="sm:text-right">
                <p className="flex items-center gap-1.5 text-xl font-semibold text-primary">
                  <TrendingDown className="size-4" aria-hidden />
                  {currency(analysis.projectedSaving)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {analysis.candidates.length} role{analysis.candidates.length === 1 ? "" : "s"} ·{" "}
                  {analysis.headcountDelta === 0
                    ? "headcount unchanged"
                    : `${analysis.headcountDelta} headcount`}
                </p>
              </div>
              <form action={formAction}>
                <input type="hidden" name="playId" value={play.id} />
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? "Modelling…" : layerOntoScenarioId ? "Layer this on" : "Model this"}
                </Button>
              </form>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">Nothing to act on</span>
          )}
        </div>
      </div>

      {state.error && (
        <p className="mx-4 mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 border-t px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
      >
        <ChevronDown
          className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
        {open ? "Hide" : "Show"} what we think, what to do, and what it&rsquo;s worth
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t bg-muted/30 p-4 text-sm">
          <Section title="1. What we think could be happening">
            <p className="text-muted-foreground">{play.thesis}</p>
            {hasCandidates && <p className="mt-1.5">{analysis.summary}</p>}
          </Section>

          <Section title="2. What we should do about it">
            <p className="text-muted-foreground">{play.action}</p>
          </Section>

          <Section title="3. What we get, and how it is calculated">
            {hasCandidates && (
              <p className="mb-1.5 text-base font-semibold text-primary">
                {currency(analysis.projectedSaving)}
                <span className="ml-2 text-xs font-normal text-muted-foreground">a year</span>
              </p>
            )}
            <p className="text-muted-foreground">{analysis.method}</p>
            {hasCandidates && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {nature.label}: {nature.hint}
              </p>
            )}
          </Section>

          {analysis.guardrailNote && (
            <Section title="What it deliberately left alone">
              <p className="flex gap-2 text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>{analysis.guardrailNote}</span>
              </p>
            </Section>
          )}

          {hasCandidates && (
            <Section title={`Roles identified (${analysis.candidates.length})`}>
              <ul className="flex flex-col divide-y rounded-md border bg-background">
                {analysis.candidates.map((c) => (
                  <li key={c.positionId} className="flex flex-wrap items-baseline gap-x-2 px-3 py-2">
                    <span className="font-medium">{c.title}</span>
                    <span className="text-xs text-muted-foreground">{c.department}</span>
                    <span className="ml-auto font-medium text-primary">{currency(c.saving)}</span>
                    <span className="w-full text-xs text-muted-foreground">{c.rationale}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="eyebrow mb-1.5">
        <span className="eyebrow-dot" aria-hidden />
        {title}
      </p>
      {children}
    </div>
  );
}
