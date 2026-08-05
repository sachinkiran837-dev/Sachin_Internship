import { currency } from "@/lib/format/currency";
import { computeMetrics } from "@/lib/metrics/diagnostics";
import { analyseFunctions } from "@/lib/analysis/functions";
import { analysePlay } from "@/lib/scenario/plays";
import { buildFootprint } from "@/lib/analysis/footprint";
import { findDuplicatedFunctions } from "@/lib/analysis/duplication";
import { buildVacancyHygiene } from "@/lib/analysis/vacancyHygiene";
import { buildContingentReliance } from "@/lib/analysis/contingentReliance";
import { buildKeyPersonRisk } from "@/lib/analysis/keyPersonRisk";
import { tagNodes } from "@/lib/graph/tagging";
import { parseScenarioText } from "@/lib/scenario/moveParser";
import { patternForParsedMove, rejectWithNearestPattern, patternMeta } from "@/lib/scenario/patterns";
import { EMPTY_BUSINESS, type BusinessContext } from "@/lib/hypothesis/context";
import { hasAI, type AiTool } from "@/lib/ai/client";
import { askWithRetry } from "@/lib/orchestrator/verify";
import type { Position } from "@/lib/graph/types";

/**
 * i3-ask-atlas-interpretation: a query compiles to exactly one of a fixed,
 * named set of engine tools, or it says so and offers the nearest one — the
 * same discipline `h1-redesign-pattern-library` already applies to a
 * restructure instruction, reused here rather than reimplemented for the
 * read-only path. Query matching is deterministic keyword recognition first,
 * always — a model is only ever asked to pick among the same seven fixed
 * tools, and only once keyword matching has already found nothing. It never
 * gets to compute an answer of its own: `runTool` below is the only thing
 * that ever produces a figure, whichever path chose which tool to run.
 *
 * Every figure in a response is read straight off a named engine function —
 * nothing here computes a number of its own that isn't already owned by the
 * diagnostic skill named in the tool trace.
 */

export type ToolId =
  | "single-report-by-cost"
  | "duplicated-functions"
  | "layers-by-division"
  | "span-outliers"
  | "contingent-by-directorate"
  | "cost-by-tier"
  | "protected-and-key-person";

interface ToolPattern {
  id: ToolId;
  label: string;
  keywords: string[];
}

const TOOLS: ToolPattern[] = [
  { id: "single-report-by-cost", label: "Single-report managers ranked by cost (b3)", keywords: ["single report", "single-report", "one report", "one direct report", "pass through", "pass-through"] },
  { id: "duplicated-functions", label: "Duplicated functions across sites (c2)", keywords: ["duplicat", "same function", "across sites", "multiple sites", "parallel function"] },
  { id: "layers-by-division", label: "Layers between the chief executive and the frontline, by division (b2)", keywords: ["layers", "how deep", "depth", "levels between"] },
  { id: "span-outliers", label: "Span outliers (b1)", keywords: ["span", "wide span", "thin span", "span of control"] },
  { id: "contingent-by-directorate", label: "Contingent reliance by directorate (d1)", keywords: ["contingent", "agency", "contractor reliance"] },
  { id: "cost-by-tier", label: "Cost by management tier (b4)", keywords: ["management tier", "cost by tier", "cost by layer", "tier cost"] },
  { id: "protected-and-key-person", label: "Protected and key-person roles (e1, e2)", keywords: ["protected role", "key person", "key-person", "control gap", "governance role", "safety-critical", "succession"] },
];

export interface AskDataRow {
  label: string;
  value: string;
}

export interface AskResponse {
  compiled: boolean;
  kind: "query" | "instruction" | null;
  toolId: ToolId | null;
  narrative: string;
  data: AskDataRow[];
  toolTrace: string;
  followUps: string[];
  mapLinks: string[];
  nearestPattern: string | null;
  /** True when keyword matching found nothing and a model picked the tool instead. */
  aiRouted: boolean;
}

function matchTools(query: string): ToolPattern[] {
  const q = query.toLowerCase();
  return TOOLS.filter((t) => t.keywords.some((k) => q.includes(k)));
}

function runTool(id: ToolId, positions: Position[], rootId: string | null, business: BusinessContext): AskResponse {
  const metrics = computeMetrics(positions, rootId);

  switch (id) {
    case "single-report-by-cost": {
      const analysis = analysePlay("pass-through-layers", positions, rootId);
      const rows = (analysis?.candidates ?? []).slice(0, 10).map((c) => ({ label: `${c.title} (${c.department})`, value: currency(c.saving) }));
      return {
        compiled: true,
        kind: "query",
        toolId: id,
        narrative: `${analysis?.candidates.length ?? 0} single-report manager${(analysis?.candidates.length ?? 0) === 1 ? "" : "s"} found, ranked by the pass-through-layers play's own priced saving.`,
        data: rows,
        toolTrace: `analysePlay("pass-through-layers", positions, rootId) — ${metrics.headcount} positions scoped.`,
        followUps: ["Which of these are also key-person flagged?", "What's the total saving if all of these were removed?"],
        mapLinks: (analysis?.candidates ?? []).slice(0, 10).map((c) => c.positionId),
        nearestPattern: null,
        aiRouted: false,
      };
    }
    case "duplicated-functions": {
      const footprint = buildFootprint(positions, rootId);
      const dupes = findDuplicatedFunctions(footprint);
      const rows = dupes.slice(0, 10).map((d) => ({ label: d.functionGroup, value: `${d.instances.length} instances, ${currency(d.captureLow)}-${currency(d.captureHigh)}` }));
      return {
        compiled: true,
        kind: "query",
        toolId: id,
        narrative: `${dupes.length} function${dupes.length === 1 ? "" : "s"} running in parallel across sites, per c1's footprint and c2's duplication check.`,
        data: rows,
        toolTrace: `findDuplicatedFunctions(buildFootprint(positions, rootId)) — ${footprint.functions.length} function(s) scanned.`,
        followUps: ["Is this real duplication or a naming artefact?", "What's the capture band if confirmed?"],
        mapLinks: [],
        nearestPattern: null,
        aiRouted: false,
      };
    }
    case "layers-by-division": {
      const { primary } = analyseFunctions(positions, rootId, business);
      const rows = primary.units.filter((u) => u.headcount > 0).map((u) => ({ label: u.key, value: `${u.layers} layer${u.layers === 1 ? "" : "s"}` }));
      return {
        compiled: true,
        kind: "query",
        toolId: id,
        narrative: `Layers from the top of each ${primary.label.toLowerCase()} to its deepest position — org-wide reads ${metrics.layers}.`,
        data: rows,
        toolTrace: `analyseFunctions(positions, rootId, business).primary.units[].layers — ${primary.dimension} cut, ${(primary.coverage * 100).toFixed(0)}% coverage.`,
        followUps: ["Which of these exceeds the layer peer band?", "What's driving the deepest division's depth?"],
        mapLinks: [],
        nearestPattern: null,
        aiRouted: false,
      };
    }
    case "span-outliers": {
      const rows = metrics.spanByArchetype.map((a) => ({ label: a.label, value: `${a.thinCount} thin, ${a.wideCount} wide, ${a.healthyCount} healthy` }));
      return {
        compiled: true,
        kind: "query",
        toolId: id,
        narrative: `${metrics.thinSpanCount} thin and ${metrics.wideSpanCount} wide spans org-wide, by work archetype.`,
        data: rows,
        toolTrace: `computeMetrics(positions, rootId).spanByArchetype — ${metrics.headcount} positions.`,
        followUps: ["Which managers are driving the wide-span count?", "Are any of the thin spans roster leads that should be exempt?"],
        mapLinks: [],
        nearestPattern: null,
        aiRouted: false,
      };
    }
    case "contingent-by-directorate": {
      const { primary } = analyseFunctions(positions, rootId, business);
      const agencyShareByUnit = new Map(primary.units.map((u) => [u.key, u.agencyShare] as const));
      const vacancy = buildVacancyHygiene(positions, rootId, agencyShareByUnit);
      const reliance = buildContingentReliance(positions, rootId, primary, vacancy);
      const rows = reliance.byShare.map((u) => ({ label: u.functionGroup, value: `${(u.agencyShare * 100).toFixed(0)}% (${u.verdict})` }));
      return {
        compiled: true,
        kind: "query",
        toolId: id,
        narrative: `${reliance.byShare.filter((u) => u.verdict === "structural").length} directorate(s) read structural, against d1's peer band.`,
        data: rows,
        toolTrace: `buildContingentReliance(positions, rootId, comparison, vacancy) — org-wide share ${(reliance.overall.agencyShare * 100).toFixed(0)}%.`,
        followUps: ["What's the premium on the largest one?", "Does the vacancy pattern explain any of these?"],
        mapLinks: [],
        nearestPattern: null,
        aiRouted: false,
      };
    }
    case "cost-by-tier": {
      const nodes = tagNodes(positions, rootId).filter((n) => !n.synthetic);
      const depths = [...new Set(nodes.map((n) => n.depth))].sort((a, b) => a - b);
      const rows = depths.map((depth) => {
        const atDepth = nodes.filter((n) => n.depth === depth);
        const cost = atDepth.reduce((s, n) => s + n.cost * n.fte, 0);
        return { label: `Tier ${depth}`, value: `${atDepth.length} positions, ${currency(cost)}` };
      });
      return {
        compiled: true,
        kind: "query",
        toolId: id,
        narrative: `Cost by management tier, top of the establishment down — ${metrics.shape.managerCostShare > 0 ? `${(metrics.shape.managerCostShare * 100).toFixed(0)}% of total cost sits with managers` : "management cost share not computable"}.`,
        data: rows,
        toolTrace: `tagNodes(positions, rootId) grouped by depth, summed by cost × FTE — ${nodes.length} real positions.`,
        followUps: ["Which tier carries the most single-report managers?", "How does this compare to the shape read (pyramid/diamond/hourglass)?"],
        mapLinks: [],
        nearestPattern: null,
        aiRouted: false,
      };
    }
    case "protected-and-key-person": {
      const keyPerson = buildKeyPersonRisk(positions, rootId);
      const rows: AskDataRow[] = [
        { label: "Protected roles held", value: String(metrics.protectedCount) },
        { label: "Statutory", value: String(metrics.protectedByTier.statutory) },
        { label: "Governance-mandated", value: String(metrics.protectedByTier.governance) },
        { label: "Safety-critical", value: String(metrics.protectedByTier.safety) },
        { label: "Control gaps", value: String(metrics.controlGaps.length) },
        { label: "Key-person flags", value: String(keyPerson.flagged.length) },
      ];
      return {
        compiled: true,
        kind: "query",
        toolId: id,
        narrative: `${metrics.protectedCount} roles held under the protected register; ${keyPerson.flagged.length} additional key-person flags, a caution rather than a hold.`,
        data: rows,
        toolTrace: `computeMetrics(...).protectedByTier/.controlGaps + buildKeyPersonRisk(positions, rootId) — ${metrics.headcount} positions scoped.`,
        followUps: ["Which control gaps are still open?", "Which key-person flags also carry an E1 hold?"],
        mapLinks: keyPerson.flagged.slice(0, 10).map((f) => f.id),
        nearestPattern: null,
        aiRouted: false,
      };
    }
  }
}

function uncompiled(nearestLabel: string | null): AskResponse {
  return {
    compiled: false,
    kind: null,
    toolId: null,
    narrative: nearestLabel
      ? `That doesn't compile to a named tool or a redesign move Atlas recognises. The nearest thing it can do: ${nearestLabel}.`
      : `That doesn't compile to a named tool or a redesign move Atlas recognises, and nothing in the library is close enough to suggest.`,
    data: [],
    toolTrace: "No engine call ran — nothing shown here was computed.",
    followUps: [],
    mapLinks: [],
    nearestPattern: nearestLabel,
    aiRouted: false,
  };
}

const PICK_TOOL: AiTool = {
  name: "pick_tool",
  description:
    "Decide whether this query about an organisation's structure clearly asks for one of Atlas's seven named tools. Never invent an eighth. If it's not a clear match to one of the seven, say so.",
  input_schema: {
    type: "object",
    properties: {
      matched: { type: "boolean", description: "True only if one tool clearly answers the query." },
      toolId: {
        type: "string",
        enum: TOOLS.map((t) => t.id),
        description: "Which tool, ignored when matched is false.",
      },
    },
    required: ["matched", "toolId"],
  },
};

/**
 * The one AI-shaped step in Ask Atlas, reached only after keyword matching
 * has already found nothing. Same discipline as `hypothesis/read.ts`: the
 * model is trusted for exactly one job — reading — and that job is picking
 * *which* of the seven fixed tools, never computing a figure of its own or
 * naming a tool that doesn't already exist in `TOOLS`.
 */
async function askModelForTool(query: string): Promise<ToolId | null> {
  // Already at the top tier, so there's nowhere to escalate to — the second
  // attempt is a genuine retry (a model can answer a second call
  // differently), not an escalation. A failed or unreachable call after both
  // falls back to the deterministic rejection below — the visible-fallback
  // rule, applied to a third AI-shaped step exactly as it already applies to
  // the first two.
  const result = await askWithRetry(
    (tier) => ({
      tier,
      maxTokens: 200,
      timeoutMs: 15000,
      system:
        "You map a free-text question about an organisation's structure onto exactly one of a fixed set of tools, or none. You never answer the question yourself.",
      prompt: `Query: "${query}"\n\nThe seven tools:\n${TOOLS.map((t) => `- ${t.id}: ${t.label}`).join("\n")}`,
      tool: PICK_TOOL,
    }),
    ["high", "high"]
  );
  if (!result) return null;
  const input = result.toolInput as { matched?: boolean; toolId?: string };
  if (!input.matched || !input.toolId) return null;
  const hit = TOOLS.find((t) => t.id === input.toolId);
  return hit ? hit.id : null;
}

export async function interpret(
  raw: string,
  positions: Position[],
  rootId: string | null,
  business: BusinessContext = EMPTY_BUSINESS
): Promise<AskResponse> {
  const query = raw.trim();
  if (query.length === 0) return uncompiled(null);

  // An instruction's grammar (imperative verb + a structured target) is far
  // more specific than a query's free-form phrasing, so it's checked first
  // — a query keyword that happens to appear inside an instruction (e.g.
  // "flatten Operations to 4 layers" contains "layers") must not steal the
  // match away from the instruction path. Caught live: this exact sentence
  // was reading as the layers-by-division *query* before the reorder.
  const parsed = parseScenarioText(query);
  if (parsed.kind !== "unrecognized") {
    const pattern = patternForParsedMove(parsed);
    if (pattern) {
      const meta = patternMeta(pattern);
      return {
        compiled: true,
        kind: "instruction",
        toolId: null,
        narrative: `Compiles to the "${meta.label}" pattern. Draft it as a scenario move to see the guardrail check and the priced change set.`,
        data: [{ label: "Pattern", value: meta.label }, { label: "Mechanic", value: meta.mechanic }],
        toolTrace: `parseScenarioText -> patternForParsedMove — matched "${pattern}".`,
        followUps: ["Draft this as a scenario and show the guardrail log.", "What would this cost?"],
        mapLinks: [],
        nearestPattern: null,
        aiRouted: false,
      };
    }
  }

  const matched = matchTools(query);
  if (matched.length === 1) {
    return runTool(matched[0].id, positions, rootId, business);
  }
  if (matched.length > 1) {
    // More than one tool is equally plausible — never silently pick one.
    return {
      compiled: false,
      kind: "query",
      toolId: null,
      narrative: `That could mean ${matched.length} different things: ${matched.map((m) => m.label).join("; ")}. Ask for one of these specifically.`,
      data: [],
      toolTrace: "No engine call ran — the query was ambiguous across more than one named tool.",
      followUps: matched.map((m) => m.label),
      mapLinks: [],
      nearestPattern: null,
      aiRouted: false,
    };
  }

  // Neither a recognised instruction (parsed.kind was "unrecognized" or its
  // move-kind doesn't map to a named pattern — e.g. a bare "remove"/
  // "reassign" this function deliberately doesn't resolve) nor a matched
  // query tool, by keyword. Before offering the nearest named pattern, give
  // a model one last look — it only ever gets to pick among the same seven
  // tools keyword matching already tried.
  const aiToolId = await askModelForTool(query);
  if (aiToolId) {
    const response = runTool(aiToolId, positions, rootId, business);
    return {
      ...response,
      toolTrace: `Deterministic keyword matching found nothing; a model picked "${aiToolId}" instead. ${response.toolTrace}`,
      aiRouted: true,
    };
  }

  const rejection = rejectWithNearestPattern(query);
  return {
    compiled: false,
    kind: null,
    toolId: null,
    narrative: rejection.reason,
    data: [],
    toolTrace: hasAI()
      ? "No engine call ran — a model looked too and couldn't place this in any of the seven tools either."
      : "No engine call ran — nothing shown here was computed.",
    followUps: [],
    mapLinks: [],
    nearestPattern: rejection.nearestPattern ? patternMeta(rejection.nearestPattern).label : null,
    aiRouted: false,
  };
}

export const ASK_METHOD =
  "Every query compiles to exactly one of seven named engine tools, or one of h1-redesign-pattern-library's seven named " +
  "redesign patterns, or a model's best guess among the same seven when keyword matching finds nothing — or it says so " +
  "honestly and offers the nearest one. Nothing shown is invented, and the tool trace names the exact engine call that " +
  "produced every figure, and says plainly when a model rather than a keyword match picked which one ran.";
