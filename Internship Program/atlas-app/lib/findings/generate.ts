import { randomUUID } from "node:crypto";
import type { DiagnosticMetrics, Finding, FindingsResult } from "@/lib/graph/types";
import { hasAI, getAnthropicClient, AI_MODEL } from "@/lib/ai/client";

const MAX_FINDINGS = 5;

function currency(n: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);
}

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
        "These roles (statutory, governance or safety-critical) are held out of scope for any redesign move — they are blocked at the point of mutation, not just flagged for review.",
      evidenceIds: ["protectedByTier"],
      followups: ["Which of these roles have a named succession plan?"],
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
      headline: `${metrics.headcount} positions, ${currency(metrics.totalCost)} in fully-loaded cost, ${metrics.layers} layers`,
      soWhat: `Average span of control is ${metrics.averageSpan.toFixed(1)} direct reports across ${metrics.layers} management layers.`,
      evidenceIds: ["headcount", "totalCost", "layers", "averageSpan"],
      followups: ["Does the layer count match the client's stated target operating model?"],
    });
  }

  return findings.slice(0, MAX_FINDINGS);
}

function fallbackNarrative(metrics: DiagnosticMetrics, findings: Finding[]): string {
  if (findings.length === 0) {
    return "Nothing notable to report against the current thresholds — this structure sits within the healthy span and layer ranges configured for this review.";
  }
  const lead = `This structure carries ${metrics.headcount} positions across ${metrics.layers} layers, at ${currency(metrics.totalCost)} in fully-loaded cost.`;
  const body = findings.map((f) => `${f.headline}: ${f.soWhat}`).join(" ");
  return `${lead} ${body}`;
}

export async function generateFindings(metrics: DiagnosticMetrics): Promise<FindingsResult> {
  const findings = buildFindings(metrics);
  const fallback = fallbackNarrative(metrics, findings);
  const followups = findings.flatMap((f) => f.followups);

  if (!hasAI()) {
    return { narrative: fallback, findings, followups, source: "fallback" };
  }

  try {
    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: `You are writing a short narrative for a Project Partner to read out to a client, framing already-computed operating-model metrics. Do not invent or recompute any number — only reference the figures given. Every claim must be traceable to one of these findings.\n\nMetrics: ${JSON.stringify(
            {
              headcount: metrics.headcount,
              totalCost: metrics.totalCost,
              layers: metrics.layers,
              averageSpan: metrics.averageSpan,
              protectedCount: metrics.protectedCount,
            }
          )}\n\nFindings: ${JSON.stringify(findings.map((f) => ({ headline: f.headline, soWhat: f.soWhat })))}\n\nWrite 2-4 sentences, plain language, no bullet points.`,
        },
      ],
    });

    const text = message.content.find((b) => b.type === "text");
    const narrative = text && text.type === "text" ? text.text.trim() : fallback;

    return { narrative: narrative || fallback, findings, followups, source: "ai" };
  } catch {
    return { narrative: fallback, findings, followups, source: "fallback" };
  }
}
