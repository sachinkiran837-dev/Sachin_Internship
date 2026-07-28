"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, CircleDashed, ThumbsDown, ThumbsUp } from "lucide-react";
import type { Hypothesis, PrizeNature } from "@/lib/hypothesis/build";
import { Badge } from "@/components/ui/badge";

/**
 * One hypothesis, showing all three of its parts at once.
 *
 * The three are never collapsed into each other and never presented apart.
 * What we think is happening, what to do about it, and what it is worth are
 * one argument — a client who can see the diagnosis but has to click for the
 * action will read the diagnosis as a criticism, and one who sees the number
 * without the reasoning will remember only the number.
 *
 * What is behind a click is the fourth part: what has to be true for the
 * argument to hold. That belongs on the card, but not ahead of it.
 */

function currency(n: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(n);
}

const NATURE_COPY: Record<PrizeNature, string> = {
  "cost-out": "Cost out — roles leave the establishment",
  "cost-rebase": "Cost rebase — headcount unchanged, the same work bought cheaper",
  "cost-avoidance": "Cost avoidance — nothing is cut, a hire is avoided",
  capacity: "Capacity — revenue or output the same people would carry",
  confidence: "Confidence — what it settles, not what it saves",
  none: "",
};

const VERDICT_COPY = {
  supported: { label: "Your hypothesis holds", icon: ThumbsUp, tone: "border-primary/40 bg-accent/40" },
  "not supported": {
    label: "The data doesn't support this",
    icon: ThumbsDown,
    tone: "border-destructive/40 bg-destructive/5",
  },
  untestable: {
    label: "Atlas can't test this yet",
    icon: CircleDashed,
    tone: "border-amber-500/40 bg-amber-500/5",
  },
} as const;

export function HypothesisCard({ orgId, hypothesis }: { orgId: string; hypothesis: Hypothesis }) {
  const [open, setOpen] = useState(false);
  const verdict = hypothesis.verdict ? VERDICT_COPY[hypothesis.verdict] : null;
  const VerdictIcon = verdict?.icon;

  return (
    <div className={`rounded-lg border bg-card ${verdict ? verdict.tone : ""}`}>
      <div className="flex flex-col gap-1.5 border-b p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-normal">
            {hypothesis.lens}
          </Badge>
          {hypothesis.unit && (
            <Badge variant="secondary" className="font-normal">
              {hypothesis.unit}
            </Badge>
          )}
          {verdict && VerdictIcon && (
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <VerdictIcon className="size-3.5" aria-hidden />
              {verdict.label}
            </span>
          )}
          {hypothesis.strength === "needs-input" && (
            <Badge variant="outline" className="ml-auto font-normal">
              Needs one line from you
            </Badge>
          )}
        </div>
        <h3 className="text-base font-semibold">{hypothesis.title}</h3>
      </div>

      <div className="flex flex-col divide-y">
        <Part n={1} title="What we think could be happening">
          <p className="leading-relaxed">{hypothesis.thinking}</p>
          {hypothesis.signals.length > 0 && (
            <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {hypothesis.signals.map((s) => (
                <div key={s.label} className="flex flex-col">
                  <dt className="text-xs text-muted-foreground">{s.label}</dt>
                  <dd className="text-sm font-semibold">
                    {s.value}
                    {s.comparison && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {s.comparison}
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </Part>

        <Part n={2} title="What we should do about it">
          <p className="leading-relaxed">{hypothesis.action}</p>
          {hypothesis.playId && (
            <Link
              href={`/org/${orgId}/scenarios#${hypothesis.playId}`}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
            >
              Model it: {hypothesis.playName}
            </Link>
          )}
        </Part>

        <Part n={3} title="What we get once we do it">
          {hypothesis.prize.amount !== null && (
            <p className="text-2xl font-semibold text-primary">
              {currency(hypothesis.prize.amount)}
              <span className="ml-2 align-middle text-xs font-normal text-muted-foreground">
                a year
              </span>
            </p>
          )}
          <p className="mt-1 leading-relaxed">{hypothesis.prize.statement}</p>
          {NATURE_COPY[hypothesis.prize.nature] && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {NATURE_COPY[hypothesis.prize.nature]}
            </p>
          )}
        </Part>
      </div>

      {hypothesis.conditions.length > 0 && (
        <>
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
            What has to be true for this to hold ({hypothesis.conditions.length})
          </button>
          {open && (
            <ul className="flex flex-col gap-1.5 border-t bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              {hypothesis.conditions.map((c, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden>·</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Part({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="p-4 text-sm">
      <p className="eyebrow mb-1.5">
        <span className="eyebrow-dot" aria-hidden />
        {n}. {title}
      </p>
      {children}
    </div>
  );
}
