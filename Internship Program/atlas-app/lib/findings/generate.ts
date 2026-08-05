import { currency } from "@/lib/format/currency";
import { randomUUID } from "node:crypto";
import type { DiagnosticMetrics, Finding, FindingsResult } from "@/lib/graph/types";
import { ask, hasAI } from "@/lib/ai/client";

const MAX_FINDINGS = 5;

/**
 * Ranks the already-computed metrics into a capped, evidence-cited findings
 * list. The protected/governance zone always gets its own dedicated finding
 * — it's the one thing a redesign must never quietly touch — rather than
 * being folded into a general summary.
 */
function buildFindings(metrics: DiagnosticMetrics): Finding[] {
  const findings: Finding[] = [];

  if (metrics.protectedCount > 0) {
    findings.push({
      id: randomUUID(),
      headline: `${metrics.protectedCount} protected or governance role${metrics.protectedCount === 1 ? "" : "s"} identified`,
      soWhat:
        "These roles (statutory, governance or safety-critical) are held out of scope for any redesign move — a change to one is refused when it is applied, not merely flagged for review.",
      evidenceIds: ["protectedByTier"],
      followups: ["Which of these roles have a named succession plan?"],
    });
  }

  if (metrics.contingentCount > 0) {
    const share = (metrics.contingentCount / Math.max(metrics.headcount, 1)) * 100;
    findings.push({
      id: randomUUID(),
      headline: `${metrics.contingentCount} of ${metrics.headcount} positions are agency or contingent labour`,
      soWhat:
        `${share.toFixed(0)}% of the people on this chart are not employed by the organisation — they hold no ` +
        `contracted FTE, which is why headcount (${metrics.headcount}) and contracted establishment ` +
        `(${metrics.totalFte.toFixed(0)} FTE) differ. Converting a share of them to permanent roles, or ` +
        `reducing reliance on them, is usually the largest single lever available.`,
      evidenceIds: ["contingentCount", "headcount", "totalFte"],
      followups: ["What is the annual agency spend behind these positions?"],
    });
  }

  for (const pattern of metrics.flaggedPatterns) {
    if (findings.length >= MAX_FINDINGS) break;
    findings.push({
      id: randomUUID(),
      headline: pattern.label,
      soWhat: pattern.detail,
      evidenceIds: [pattern.id],
      followups: [`Which of the ${pattern.positionIds.length} flagged position(s) should be modelled in a scenario first?`],
    });
  }

  if (findings.length < MAX_FINDINGS) {
    findings.push({
      id: randomUUID(),
      headline: `${metrics.headcount} positions, ${metrics.totalFte.toFixed(0)} contracted FTE, ${currency(metrics.totalCost)} in fully-loaded cost, ${metrics.layers} layers`,
      soWhat: `Average span of control is ${metrics.averageSpan.toFixed(1)} direct reports across ${metrics.layers} management layers.`,
      evidenceIds: ["headcount", "totalFte", "totalCost", "layers", "averageSpan"],
      followups: ["Does the layer count match the client's stated target operating model?"],
    });
  }

  return findings.slice(0, MAX_FINDINGS);
}

/**
 * The lead fact plus a one-line pointer to the headlines below it — never
 * the full account. `findings[].soWhat` is a paragraph in its own right, and
 * concatenating all of them here is what used to turn the summary into the
 * longest reading on the page; the detail already has a place, further down.
 */
function fallbackNarrative(metrics: DiagnosticMetrics, findings: Finding[]): string {
  if (findings.length === 0) {
    return "Nothing notable to report against the current thresholds — this structure sits within the healthy span and layer ranges configured for this review.";
  }
  const lead = `This structure carries ${metrics.headcount} positions across ${metrics.layers} layers, at ${currency(metrics.totalCost)} in fully-loaded cost.`;
  const headlines = findings.slice(0, 3).map((f) => f.headline.toLowerCase());
  return `${lead} Also flagged: ${headlines.join("; ")}.`;
}

/**
 * The findings themselves: ranked, capped, evidence-cited, and computed
 * entirely from the metrics. No network, no key, no waiting — this is what a
 * client is actually being shown, and it must never be held up by the
 * sentence that introduces it.
 */
export function buildFindingsResult(metrics: DiagnosticMetrics): FindingsResult {
  const findings = buildFindings(metrics);
  return {
    narrative: fallbackNarrative(metrics, findings),
    findings,
    followups: findings.flatMap((f) => f.followups),
    source: "fallback",
  };
}

/** Time the wording gets before the computed narrative is used instead. */
const NARRATIVE_TIMEOUT_MS = 12_000;

/**
 * The framing paragraph, drafted from figures that are already final.
 *
 * Kept separate and time-boxed because it is the only slow part of this page
 * and the least important: a findings screen that renders in 7 seconds — or
 * times out at the host's edge and renders not at all — has failed at the one
 * thing it is for, whatever the prose was going to say.
 *
 * When the hypothesis layer has produced hypotheses, they are what gets
 * framed. The metrics are the raw material; the argument the client came for
 * is "here is what we think is happening, here is what to do, here is what it
 * is worth", and a summary that led on span-of-control averages instead would
 * be introducing a different screen.
 */
export async function generateNarrative(
  metrics: DiagnosticMetrics,
  hypotheses: {
    title: string;
    thinking: string;
    action: string;
    prize: { amount: number | null; statement: string };
    verdict: string | null;
  }[] = []
): Promise<FindingsResult> {
  const findings = buildFindings(metrics);
  const fallback = fallbackNarrative(metrics, findings);
  const followups = findings.flatMap((f) => f.followups);

  if (!hasAI()) {
    return { narrative: fallback, findings, followups, source: "fallback" };
  }

  const material =
    hypotheses.length > 0
      ? `Hypotheses, already computed: ${JSON.stringify(
          hypotheses.slice(0, 4).map((h) => ({
            what_we_think: h.title,
            reasoning: h.thinking,
            what_to_do: h.action,
            what_we_get: h.prize.statement,
            verdict_on_client_belief: h.verdict,
          }))
        )}`
      : `Findings: ${JSON.stringify(findings.map((f) => ({ headline: f.headline, soWhat: f.soWhat })))}`;

  try {
    const answer = await ask({
      maxTokens: 160,
      timeoutMs: NARRATIVE_TIMEOUT_MS,
      prompt:
        `You are writing a short narrative for a Project Partner to read out to a client, framing ` +
        `an already-computed operating-model analysis. Do not invent or recompute any number — only ` +
        `reference the figures given. Every claim must be traceable to what follows.\n\n` +
        `Metrics: ${JSON.stringify({
          headcount: metrics.headcount,
          totalFte: metrics.totalFte,
          contingentCount: metrics.contingentCount,
          totalCost: metrics.totalCost,
          layers: metrics.layers,
          averageSpan: metrics.averageSpan,
          protectedCount: metrics.protectedCount,
        })}\n\n${material}\n\n` +
        `Write exactly 2-3 short sentences — no more than 3-4 lines read aloud, and no bullet ` +
        `points. Lead with what the analysis thinks is happening rather than with a count of ` +
        `positions. Where a client belief was tested and not supported, say so — that is the most ` +
        `useful sentence on the page. The detail behind every figure is already shown further down ` +
        `this page, so this is the headline, not the account.`,
    });

    return { narrative: answer.text || fallback, findings, followups, source: "ai" };
  } catch {
    return { narrative: fallback, findings, followups, source: "fallback" };
  }
}
