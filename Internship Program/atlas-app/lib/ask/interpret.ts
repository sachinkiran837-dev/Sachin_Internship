import { currency } from "@/lib/format/currency";
import { computeMetrics } from "@/lib/metrics/diagnostics";
import { analyseFunctions } from "@/lib/analysis/functions";
import { analysePlay } from "@/lib/scenario/plays";
import { buildFootprint } from "@/lib/analysis/footprint";
import { findDuplicatedFunctions } from "@/lib/analysis/duplication";
import { buildVacancyHygiene } from "@/lib/analysis/vacancyHygiene";
import { buildContingentReliance } from "@/lib/analysis/contingentReliance";
import { buildKeyPersonRisk } from "@/lib/analysis/keyPersonRisk";
import { benchmarkFunctions } from "@/lib/analysis/backOfficeBenchmarks";
import { computeProductivity } from "@/lib/analysis/productivity";
import { buildWorkforceMix } from "@/lib/analysis/workforceMix";
import { mapAwardCoverage } from "@/lib/analysis/irEbaOverlay";
import { buildPeerBenchmark } from "@/lib/analysis/peerBenchmark";
import { buildHypotheses } from "@/lib/hypothesis/build";
import { tagNodes } from "@/lib/graph/tagging";
import { parseScenarioText } from "@/lib/scenario/moveParser";
import { patternForParsedMove, rejectWithNearestPattern, patternMeta } from "@/lib/scenario/patterns";
import { EMPTY_BUSINESS, type BusinessContext } from "@/lib/hypothesis/context";
import { ask, hasAI, type AiTool } from "@/lib/ai/client";
import { askWithRetry } from "@/lib/orchestrator/verify";
import type { IngestIssue, Position } from "@/lib/graph/types";

/**
 * i3-ask-atlas-interpretation: a query compiles to exactly one of a fixed,
 * named set of engine tools — now one per built skill that has a genuine
 * standalone "answer a question about this establishment" shape, sixteen in
 * total — or it says so and offers the nearest one, the same discipline
 * `h1-redesign-pattern-library` already applies to a restructure instruction.
 *
 * Three things a model is trusted for here, and nothing else:
 *   1. Picking which tool answers a query, when keyword matching finds none.
 *   2. Picking which *already-run* tool's result best answers a query, when
 *      keyword matching finds several candidates and can't choose between
 *      them.
 *   3. Phrasing the final answer from a tool's own computed output.
 * None of the three ever computes a figure. `runTool` is the only thing that
 * ever produces a number, whichever path chose which tool to run — a model
 * reads the result runTool already produced and writes English around it, or
 * points at which result to read, never the other way round.
 */

export type ToolId =
  | "single-report-by-cost"
  | "duplicated-functions"
  | "layers-by-division"
  | "span-outliers"
  | "contingent-by-directorate"
  | "cost-by-tier"
  | "protected-and-key-person"
  | "reporting-hygiene"
  | "operating-model"
  | "back-office-benchmarks"
  | "productivity"
  | "workforce-mix"
  | "vacancy-hygiene"
  | "award-coverage"
  | "peer-benchmark"
  | "top-opportunities";

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
  { id: "reporting-hygiene", label: "Reporting-line hygiene (b5)", keywords: ["orphan", "unresolved manager", "reporting hygiene", "coordinator role"] },
  { id: "operating-model", label: "Operating-model pattern by function (c1)", keywords: ["operating model", "centralize", "centralise", "federate", "federated", "shared service", "hub and spoke", "hub-and-spoke"] },
  { id: "back-office-benchmarks", label: "Back-office efficiency vs. sector band (c3)", keywords: ["back office", "back-office", "sector band", "benchmark function"] },
  { id: "productivity", label: "Productivity ratios (c4)", keywords: ["productivity", "revenue per fte", "revenue per head", "output per"] },
  { id: "workforce-mix", label: "Workforce mix and classification drift (d3)", keywords: ["workforce mix", "seniority", "grade distribution", "classification drift", "grade mix"] },
  { id: "vacancy-hygiene", label: "Funded vacancy establishment hygiene (d2)", keywords: ["vacant", "vacancy", "funded vacant", "unfilled"] },
  { id: "award-coverage", label: "Award/EBA coverage by grade (e3)", keywords: ["award", "enterprise agreement", "eba", "industrial instrument", "industrial coverage"] },
  { id: "peer-benchmark", label: "Peer-band comparison — layers, spans, overhead, contingent, corporate cost (f1)", keywords: ["peer band", "peer benchmark", "against peers", "how do we compare", "compare to peers", "vs peers"] },
  { id: "top-opportunities", label: "Top priced redesign opportunities, ranked (g1/g2)", keywords: ["top opportunit", "biggest saving", "where's the money", "where is the money", "best opportunity", "ranked opportunit"] },
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
  /** True when keyword matching didn't settle it alone and a model picked or arbitrated instead. */
  aiRouted: boolean;
}

function matchTools(query: string): ToolPattern[] {
  const q = query.toLowerCase();
  return TOOLS.filter((t) => t.keywords.some((k) => q.includes(k)));
}

function runTool(
  id: ToolId,
  positions: Position[],
  rootId: string | null,
  business: BusinessContext,
  issues: Pick<IngestIssue, "kind">[]
): AskResponse {
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
    case "reporting-hygiene": {
      const { hygiene } = metrics;
      const rows: AskDataRow[] = [
        { label: "Orphan records", value: String(hygiene.orphanCount) },
        { label: "Coordinator-style roles", value: String(hygiene.coordinatorCount) },
        { label: "Support ratio", value: `${(hygiene.supportRatio * 100).toFixed(0)}%` },
      ];
      return {
        compiled: true,
        kind: "query",
        toolId: id,
        narrative: `${hygiene.orphanCount} orphan record${hygiene.orphanCount === 1 ? "" : "s"} and ${hygiene.coordinatorCount} coordinator-style role${hygiene.coordinatorCount === 1 ? "" : "s"} on this chart, per b5's hygiene read.`,
        data: rows,
        toolTrace: `computeMetrics(positions, rootId).hygiene — ${metrics.headcount} positions.`,
        followUps: ["Which specific records are orphaned?", "Is the support ratio in line with peers?"],
        mapLinks: [],
        nearestPattern: null,
        aiRouted: false,
      };
    }
    case "operating-model": {
      const footprint = buildFootprint(positions, rootId);
      const rows = footprint.functions
        .filter((f) => f.recommendedPattern)
        .map((f) => ({ label: f.functionGroup, value: f.recommendedPattern as string }));
      return {
        compiled: true,
        kind: "query",
        toolId: id,
        narrative: `Recommended operating-model pattern per function, from c1's footprint read across ${footprint.functions.length} function${footprint.functions.length === 1 ? "" : "s"}.`,
        data: rows,
        toolTrace: `buildFootprint(positions, rootId).functions[].recommendedPattern — ${footprint.functions.length} function(s) scanned.`,
        followUps: ["What's the trade-off behind the largest function's recommendation?", "Does site data support a centralise/federate call here?"],
        mapLinks: [],
        nearestPattern: null,
        aiRouted: false,
      };
    }
    case "back-office-benchmarks": {
      const { primary } = analyseFunctions(positions, rootId, business);
      const readings = benchmarkFunctions(primary, business, metrics.totalFte);
      const rows = readings.map((r) => ({ label: r.functionGroup, value: `${r.verdict}${r.bandLabel ? ` (${r.bandLabel})` : ""}` }));
      return {
        compiled: true,
        kind: "query",
        toolId: id,
        narrative: `${readings.filter((r) => r.verdict === "over").length} back-office function(s) read over their sector band, per c3.`,
        data: rows,
        toolTrace: `benchmarkFunctions(analyseFunctions(positions, rootId, business).primary, business, metrics.totalFte) — ${readings.length} function(s) read.`,
        followUps: ["Which function is furthest over its band?", "Does the outsourcing caveat apply to any of these?"],
        mapLinks: [],
        nearestPattern: null,
        aiRouted: false,
      };
    }
    case "productivity": {
      const reading = computeProductivity(metrics, business);
      const rows: AskDataRow[] = [
        { label: "Instantiation", value: reading.instantiation },
        {
          label: "Revenue per FTE",
          value: reading.revenuePerFte !== null ? currency(reading.revenuePerFte) : "not computable",
        },
      ];
      return {
        compiled: true,
        kind: "query",
        toolId: id,
        narrative:
          reading.revenuePerFte !== null
            ? `Revenue per FTE reads ${currency(reading.revenuePerFte)}, per c4 (${reading.instantiation}).`
            : `Revenue per FTE is not computable from what's been supplied. ${reading.safeStaffingNote}`,
        data: rows,
        toolTrace: `computeProductivity(metrics, business) — ${reading.method}`,
        followUps: ["What revenue figure would unlock this?", "How does this compare to the peer band?"],
        mapLinks: [],
        nearestPattern: null,
        aiRouted: false,
      };
    }
    case "workforce-mix": {
      const mix = buildWorkforceMix(positions, rootId);
      const rows = mix.byUnit
        .filter((u) => u.seniorShare !== null)
        .slice(0, 10)
        .map((u) => ({ label: u.department, value: `${((u.seniorShare ?? 0) * 100).toFixed(0)}% senior` }));
      return {
        compiled: true,
        kind: "query",
        toolId: id,
        narrative: `Senior-share and grade distribution by unit, per d3 — ${(mix.gradeCoverage * 100).toFixed(0)}% grade coverage.`,
        data: rows,
        toolTrace: `buildWorkforceMix(positions, rootId) — ${mix.byUnit.length} unit(s).`,
        followUps: ["Which unit has drifted furthest from its peer median seniority?", "Is fragmentation concentrated in one unit?"],
        mapLinks: [],
        nearestPattern: null,
        aiRouted: false,
      };
    }
    case "vacancy-hygiene": {
      const { primary } = analyseFunctions(positions, rootId, business);
      const agencyShareByUnit = new Map(primary.units.map((u) => [u.key, u.agencyShare] as const));
      const vacancy = buildVacancyHygiene(positions, rootId, agencyShareByUnit);
      const rows = vacancy.byUnit
        .filter((u) => u.vacantCount > 0)
        .map((u) => ({ label: u.functionGroup, value: `${u.vacantCount} vacant, ${currency(u.fundedVacantCost)}` }));
      return {
        compiled: true,
        kind: "query",
        toolId: id,
        narrative: `${vacancy.vacantCount} of ${vacancy.headcount} positions are vacant but funded, per d2 — ${currency(vacancy.fundedVacantCost)} carried.`,
        data: rows,
        toolTrace: `buildVacancyHygiene(positions, rootId, agencyShareByUnit) — ${vacancy.headcount} positions.`,
        followUps: ["Which vacancies have been open longest?", "Could any of these close without backfilling?"],
        mapLinks: [],
        nearestPattern: null,
        aiRouted: false,
      };
    }
    case "award-coverage": {
      const coverage = mapAwardCoverage(positions);
      const unmapped = coverage.filter((c) => !c.mapped);
      const rows = coverage.map((c) => ({ label: c.grade, value: c.mapped ? (c.instrument as string) : "not mapped" }));
      return {
        compiled: true,
        kind: "query",
        toolId: id,
        narrative: `${unmapped.length} of ${coverage.length} grade${coverage.length === 1 ? "" : "s"} have no matched award or agreement, per e3.`,
        data: rows,
        toolTrace: `mapAwardCoverage(positions) — ${coverage.length} grade(s) scanned.`,
        followUps: ["Which unmapped grade carries the most headcount?", "Does this affect the churn-budget read for a scenario?"],
        mapLinks: [],
        nearestPattern: null,
        aiRouted: false,
      };
    }
    case "peer-benchmark": {
      const { primary } = analyseFunctions(positions, rootId, business);
      const agencyShareByUnit = new Map(primary.units.map((u) => [u.key, u.agencyShare] as const));
      const vacancy = buildVacancyHygiene(positions, rootId, agencyShareByUnit);
      const reliance = buildContingentReliance(positions, rootId, primary, vacancy);
      const peer = buildPeerBenchmark(positions, rootId, metrics, metrics.shape.managerCost, business, primary, reliance);
      const rows = peer.readings.map((r) => ({
        label: r.label,
        value: `${r.unit === "ratio" ? `${(r.value * 100).toFixed(0)}%` : r.value.toFixed(1)} (${r.verdict})`,
      }));
      return {
        compiled: true,
        kind: "query",
        toolId: id,
        narrative: `${peer.cohort.label} peer band — ${peer.readings.filter((r) => r.verdict === "over peers").length} reading(s) over peers, per f1.`,
        data: rows,
        toolTrace: `buildPeerBenchmark(...) — cohort ${peer.cohort.label}${peer.cohort.provisional ? " (provisional)" : ""}.`,
        followUps: ["Which peer-band reading is furthest out of range?", "Is the cohort calibrated for this establishment's size?"],
        mapLinks: [],
        nearestPattern: null,
        aiRouted: false,
      };
    }
    case "top-opportunities": {
      const { hypotheses } = buildHypotheses(positions, rootId, business, issues);
      const priced = hypotheses
        .filter((h) => h.prize.amount !== null)
        .sort((a, b) => (b.prize.amount ?? 0) - (a.prize.amount ?? 0))
        .slice(0, 5);
      const rows = priced.map((h) => ({ label: h.title, value: currency(h.prize.amount as number) }));
      return {
        compiled: true,
        kind: "query",
        toolId: id,
        narrative: `${priced.length} priced opportunit${priced.length === 1 ? "y" : "ies"}, ranked by value — largest is ${
          priced[0] ? currency(priced[0].prize.amount as number) : "none"
        }, per g1/g2.`,
        data: rows,
        toolTrace: `buildHypotheses(positions, rootId, business, issues).hypotheses — ranked by prize.amount, ${hypotheses.length} generated.`,
        followUps: ["What does the top hypothesis assume?", "Which of these overlaps with another on the same roles?"],
        mapLinks: [],
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
    "Decide whether this query about an organisation's structure clearly asks for one of Atlas's named tools. Never invent one that isn't listed. If it's not a clear match to one of them, say so.",
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
 * *which* of the named tools, never computing a figure of its own or naming
 * a tool that doesn't already exist in `TOOLS`.
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
      prompt: `Query: "${query}"\n\nThe tools:\n${TOOLS.map((t) => `- ${t.id}: ${t.label}`).join("\n")}`,
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

const PICK_BEST: AiTool = {
  name: "pick_best",
  description:
    "Several tools already ran and produced real results. Pick which one's result actually answers the question. Never combine numbers from more than one, and never state a figure that isn't in the chosen result.",
  input_schema: {
    type: "object",
    properties: {
      index: { type: "number", description: "0-based index into the candidate list of the one that best answers the query." },
    },
    required: ["index"],
  },
};

/**
 * Reached only when keyword matching finds more than one plausible tool — a
 * genuine ambiguity, not a gap. Every candidate has already been run by
 * `runTool` before this is called, so the model is choosing between real,
 * already-computed results, never guessing blind among labels the way
 * `askModelForTool` does when nothing matched at all.
 */
async function askModelToPickBest(query: string, candidates: AskResponse[]): Promise<AskResponse | null> {
  const result = await askWithRetry(
    (tier) => ({
      tier,
      maxTokens: 150,
      timeoutMs: 15000,
      system: "You pick which of several already-computed results best answers a question. You never compute a new figure.",
      prompt: `Query: "${query}"\n\nCandidates:\n${candidates
        .map((c, i) => `${i}: [${c.toolId}] ${c.narrative}`)
        .join("\n")}`,
      tool: PICK_BEST,
    }),
    ["medium", "high"]
  );
  if (!result) return null;
  const input = result.toolInput as { index?: number };
  return typeof input.index === "number" ? (candidates[input.index] ?? null) : null;
}

/**
 * The one place Ask Atlas lets a model write prose, and only once every
 * number in it already exists. Same discipline as `findings/generate.ts`'s
 * narrative: the model drafts the sentence from a result `runTool` already
 * computed — it is never asked to produce or check a figure, only to answer
 * the client's actual question in plain language instead of the fixed
 * template sentence a tool case writes for itself.
 *
 * Falls back to that fixed sentence, unchanged, whenever there's no model
 * configured or the call fails — Ask Atlas already answers correctly with no
 * AI at all, and this is a better sentence on top of that answer, never a
 * replacement it depends on.
 */
async function composeAnswer(query: string, response: AskResponse): Promise<string> {
  if (!hasAI() || !response.compiled) return response.narrative;

  try {
    const answer = await ask({
      maxTokens: 200,
      timeoutMs: 12_000,
      prompt:
        `Answer this question about an organisation's structure in 1-3 short, plain-language ` +
        `sentences. Use only the figures below — never invent or recompute a number, and never ` +
        `state a figure that isn't already in them.\n\n` +
        `Question: "${query}"\n\n` +
        `Already-computed result (tool: ${response.toolId}):\n${response.narrative}\n\n` +
        `Supporting data: ${JSON.stringify(response.data)}`,
    });
    return answer.text.trim() || response.narrative;
  } catch {
    return response.narrative;
  }
}

export async function interpret(
  raw: string,
  positions: Position[],
  rootId: string | null,
  business: BusinessContext = EMPTY_BUSINESS,
  issues: Pick<IngestIssue, "kind">[] = []
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
    const response = runTool(matched[0].id, positions, rootId, business, issues);
    return { ...response, narrative: await composeAnswer(query, response) };
  }

  if (matched.length > 1) {
    // More than one tool is plausible by keyword alone. Run every candidate
    // — each is a real, already-computed result — and let a model choose
    // between them rather than bouncing the question back to the client
    // unanswered. With no model configured there's no safe way to choose
    // automatically, so the honest thing is still to say it's ambiguous.
    if (hasAI()) {
      const candidates = matched.map((t) => runTool(t.id, positions, rootId, business, issues));
      const winner = await askModelToPickBest(query, candidates);
      if (winner) {
        return {
          ...winner,
          narrative: await composeAnswer(query, winner),
          toolTrace: `Matched ${matched.length} tools by keyword; a model picked "${winner.toolId}" as the best fit. ${winner.toolTrace}`,
          aiRouted: true,
        };
      }
    }
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
  // a model one last look — it only ever gets to pick among the same named
  // tools keyword matching already tried.
  const aiToolId = await askModelForTool(query);
  if (aiToolId) {
    const response = runTool(aiToolId, positions, rootId, business, issues);
    return {
      ...response,
      narrative: await composeAnswer(query, response),
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
      ? "No engine call ran — a model looked too and couldn't place this in any of the named tools either."
      : "No engine call ran — nothing shown here was computed.",
    followUps: [],
    mapLinks: [],
    nearestPattern: rejection.nearestPattern ? patternMeta(rejection.nearestPattern).label : null,
    aiRouted: false,
  };
}

export const ASK_METHOD =
  "Every query compiles to exactly one of Atlas's named engine tools — one per built skill with a genuine " +
  "standalone question to answer — or one of h1-redesign-pattern-library's seven named redesign patterns, or a " +
  "model's best guess among the same tools when keyword matching finds nothing, or a model's pick between several " +
  "already-computed results when keyword matching finds more than one — or it says so honestly and offers the " +
  "nearest one. Nothing shown is invented: every figure traces to one named engine call, shown in the response's " +
  "own tool trace, and a model is only ever used to pick which call ran or to phrase the sentence around a call's " +
  "own output, never to produce a number of its own.";
