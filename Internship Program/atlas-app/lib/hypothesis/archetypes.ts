import type { Hypothesis } from "@/lib/hypothesis/build";

/**
 * g1-hypothesis-generation: turns a computed finding into a hypothesis a
 * room can prosecute. Every other hypothesis generator in build.ts already
 * produces the evidence block (`signals`) and the causal story (`thinking`)
 * — this module is the one enrichment pass applied to the assembled array,
 * rather than eighteen separate rewrites, so a new generator gets archetype
 * tagging, a confidence grade, questions, a falsifier and a data ask for
 * free just by having an id and the fields every hypothesis already carries.
 *
 * The skill spec labels causal story / questions / falsifier / data-ask as
 * model calls. This build keeps them deterministic and templated instead,
 * the same choice already made for every other narrative sentence in
 * build.ts — a model call here would let the prose say something the
 * evidence block doesn't support, which a query-interpretation touchpoint
 * elsewhere in the app can't (it only ever picks which fixed engine function
 * runs; see `lib/ai/client.ts`'s `AiTier` doc comment for the full
 * inventory). A template keyed to the archetype and parameterised with the
 * hypothesis's own unit/title is grounded by construction: it cannot state a
 * fact the evidence block doesn't already carry, because it never sees one.
 */

export type Archetype =
  | "excess-management-depth"
  | "parallel-corporate-functions"
  | "contingent-concentration"
  | "span-outliers"
  | "top-heavy-shape"
  | "stacked-single-report-chains"
  | "funded-vacancy-latency"
  | "classification-drift"
  | "fragmentation-overhead"
  | "key-person-exposure"
  | "control-gap"
  | "function-investment-variance";

export const ARCHETYPE_LIBRARY: { id: Archetype; label: string; sources: string }[] = [
  { id: "excess-management-depth", label: "Excess management depth in a named estate", sources: "b2 + b3" },
  { id: "parallel-corporate-functions", label: "Corporate functions running in parallel across sites", sources: "c1 + c2" },
  { id: "contingent-concentration", label: "Contingent reliance concentrated in named directorates", sources: "d1 + d2" },
  { id: "span-outliers", label: "Span outliers at a named tier", sources: "b1" },
  { id: "top-heavy-shape", label: "Top-heavy or diamond shape, seniority drift", sources: "b4 + d3" },
  { id: "stacked-single-report-chains", label: "Stacked single-report chains taxing one decision path", sources: "b3" },
  { id: "funded-vacancy-latency", label: "Funded-vacancy latency", sources: "d2" },
  { id: "classification-drift", label: "Classification or grade drift", sources: "d3" },
  { id: "fragmentation-overhead", label: "Fragmentation overhead in part-time-heavy units", sources: "d3" },
  { id: "key-person-exposure", label: "Key-person exposure in control positions", sources: "e2" },
  { id: "control-gap", label: "Control gap: a mandated role missing or uncovered", sources: "e1" },
  { id: "function-investment-variance", label: "Function over- or under-investment against reference ratios", sources: "c3 + c4" },
];

const PLAY_ARCHETYPE: Record<string, Archetype> = {
  "deep-chain-compression": "excess-management-depth",
  "pass-through-layers": "stacked-single-report-chains",
  "manager-ratio": "stacked-single-report-chains",
  "thin-span-consolidation": "span-outliers",
  "wide-span-redistribution": "span-outliers",
  "vacancy-rationalisation": "funded-vacancy-latency",
  "agency-premium": "contingent-concentration",
  "contractor-insourcing": "contingent-concentration",
  "shared-service": "parallel-corporate-functions",
};

/**
 * Findings matching none of the 12 are held separately rather than forced
 * into the nearest one — this returns `[]`, not a guessed single archetype.
 * A hypothesis can also carry two at once (e.g. a workforce-mix reading that
 * is both seniority drift and fragmentation) rather than being split into
 * two competing hypotheses on the same evidence.
 */
export function classifyArchetype(h: Hypothesis): Archetype[] {
  const out = new Set<Archetype>();
  const id = h.id;

  if (h.playId && PLAY_ARCHETYPE[h.playId]) out.add(PLAY_ARCHETYPE[h.playId]);

  if (id.startsWith("excess-depth:") || id === "structure:pass-through") {
    out.add(id === "structure:pass-through" ? "stacked-single-report-chains" : "excess-management-depth");
  }
  if (id.startsWith("centralization:") || id.startsWith("duplication:")) out.add("parallel-corporate-functions");
  if (id.startsWith("contingent-reliance:") || id === "workforce-mix:agency") out.add("contingent-concentration");
  if (id === "shape:read") out.add("top-heavy-shape");
  if (id === "structure:vacancies" || id === "vacancy-hygiene:long-vacant") out.add("funded-vacancy-latency");
  if (id.startsWith("workforce-mix:") && id !== "workforce-mix:agency") {
    // A per-department D3 reading carries both signals at once when both fired.
    if (h.signals.some((s) => /senior/i.test(s.label))) out.add("top-heavy-shape");
    if (h.signals.some((s) => /senior/i.test(s.label))) out.add("classification-drift");
    if (h.signals.some((s) => /fragment/i.test(s.label))) out.add("fragmentation-overhead");
    if (out.size === 0) out.add("classification-drift");
  }
  if (id === "key-person-risk:overview") out.add("key-person-exposure");
  if (id === "control-gap:overview") out.add("control-gap");
  if (id.startsWith("back-office:") || id === "productivity:spread") out.add("function-investment-variance");

  return [...out];
}

/**
 * high: two or more independent signals on clean, computed data.
 * medium: one strong signal, or the hypothesis is itself a stated data gap.
 * low: a suggestive pattern only — thin evidence, or a client belief the
 * establishment could neither confirm nor rule out.
 *
 * Mechanical, per the skill's own mechanism map: applied against signal
 * count and data cleanliness, nothing judged case by case.
 */
export function gradeConfidence(h: Hypothesis): "high" | "medium" | "low" {
  if (h.strength === "needs-input") return "medium";
  if (h.verdict === "untestable") return "low";
  if (h.strength === "observed" && h.signals.length >= 2) return "high";
  if (h.signals.length >= 1) return "medium";
  return "low";
}

interface ArchetypeCopy {
  questions: (h: Hypothesis) => string[];
  falsifier: (h: Hypothesis) => string;
  dataAsk: (h: Hypothesis) => string;
}

const subject = (h: Hypothesis) => h.unit ?? "this structure";

const COPY: Record<Archetype, ArchetypeCopy> = {
  "excess-management-depth": {
    questions: (h) => [
      `Where in ${subject(h)} do decisions actually stall — at a named layer, or nowhere anyone can point to?`,
      `Which two tiers in ${subject(h)} could collapse without losing a genuine control point?`,
      `Was this depth added to solve a problem that has since been solved, and never taken back out?`,
    ],
    falsifier: (h) =>
      `A layer-by-layer walk of ${subject(h)} that finds a real decision made at every tier this hypothesis names as excess.`,
    dataAsk: (h) => `Nothing further needed — layers and cost are already computed directly from ${subject(h)}'s reporting lines.`,
  },
  "parallel-corporate-functions": {
    questions: (h) => [
      `Is the duplication in ${subject(h)} real, or a naming artefact — the same process under two labels?`,
      `Which site's version of this function has the capacity or system fit to absorb the other?`,
      `What would break locally if this function centralised tomorrow?`,
    ],
    falsifier: () =>
      `Someone who knows both sites' teams confirms they run genuinely different processes, not the same one under two names.`,
    dataAsk: () => `Confirmation from someone who knows both sites' day-to-day work that this is real duplication, not a naming artefact.`,
  },
  "contingent-concentration": {
    questions: (h) => [
      `Is the agency reliance in ${subject(h)} covering surge, or has it become the establishment?`,
      `What would it take to convert the largest contingent roles in ${subject(h)} to permanent at the same classification?`,
      `Does the vacancy pattern in ${subject(h)} explain the agency share, or is it a separate problem?`,
    ],
    falsifier: (h) => `A roster or shift-fill record showing the contingent headcount in ${subject(h)} is genuine, short-term surge cover.`,
    dataAsk: (h) => `Roster, vacancy and shift-fill data for ${subject(h)} — it turns the premium estimate into a confirmed number and prices the conversion.`,
  },
  "span-outliers": {
    questions: (h) => [
      `Is the span in ${subject(h)} thin because the work is genuinely more supervision-intensive, or because a team was never merged?`,
      `Which of the thin-span managers in ${subject(h)} would take on a merged team without losing control of it?`,
      `Would widening this span change what gets delivered, or just who signs off on it?`,
    ],
    falsifier: (h) => `A description of the work in ${subject(h)} that needs closer supervision than the calibration band assumes for this role type.`,
    dataAsk: (h) => `Nothing further needed — spans are already computed directly from the reporting lines in ${subject(h)}.`,
  },
  "top-heavy-shape": {
    questions: (h) => [
      `Is the seniority mix in ${subject(h)} a deliberate design choice, or drift nobody has looked at in aggregate?`,
      `Which senior roles in ${subject(h)} are carrying genuinely more complex work than their peers elsewhere?`,
      `Would the pyramid this organisation says it wants survive ${subject(h)} being read on its own?`,
    ],
    falsifier: (h) => `A role-by-role review of ${subject(h)}'s senior grades that finds complexity or scope matching the seniority, not drift.`,
    dataAsk: (h) => `A role-level scope description for the senior grades in ${subject(h)}, to test seniority against complexity rather than headcount alone.`,
  },
  "stacked-single-report-chains": {
    questions: (h) => [
      `What does each single-report role in ${subject(h)} decide that the level above it does not?`,
      `Which of these roles would simply return work to the person already doing it, if removed?`,
      `Is any of these a career step someone is mid-way through, not a structural layer?`,
    ],
    falsifier: () => `Even one of the named single-report managers making a decision the level above them genuinely could not make.`,
    dataAsk: (h) => `Nothing further needed — single-report chains are already computed directly from the reporting lines in ${subject(h)}.`,
  },
  "funded-vacancy-latency": {
    questions: () => [
      `Is the work behind this vacancy being absorbed elsewhere, or is something already being dropped?`,
      `How long has the role actually been open against how long it's been budgeted?`,
      `Would closing it now, or backfilling it, be the decision this organisation would rather not defer again?`,
    ],
    falsifier: () => `A manager confirming the vacant role's work is genuinely still needed and not already being covered.`,
    dataAsk: () => `A line manager's confirmation of whether the vacant role's work is currently covered, and by whom.`,
  },
  "classification-drift": {
    questions: (h) => [
      `Is ${subject(h)}'s grade mix a response to genuinely more complex work, or drift against its own peers?`,
      `What would ${subject(h)} look like if it were regraded against the peer department this comparison uses?`,
      `Who signed off the classifications behind this mix, and when were they last reviewed?`,
    ],
    falsifier: (h) => `A role-scope review of ${subject(h)} that finds the higher grades doing genuinely higher-grade work.`,
    dataAsk: (h) => `A classification/grading policy document for ${subject(h)}, to test whether the mix reflects a stated rule or drift.`,
  },
  "fragmentation-overhead": {
    questions: (h) => [
      `Could the part-time roles in ${subject(h)} combine into fewer, fuller positions without losing coverage?`,
      `What coverage requirement — hours, roster, site — is actually forcing the fragmentation in ${subject(h)}?`,
      `Would the people currently in these part-time roles want more hours, or is fragmentation their preference?`,
    ],
    falsifier: (h) => `A rostering or coverage requirement in ${subject(h)} that genuinely cannot be met by fewer, fuller positions.`,
    dataAsk: (h) => `The rostering or coverage rule driving the part-time split in ${subject(h)}, to test whether fragmentation is a genuine requirement or an artefact.`,
  },
  "key-person-exposure": {
    questions: () => [
      `Which of these roles has no documented process behind it — only the person currently holding it?`,
      `If the highest-tenure name on this list left tomorrow, how long before the gap became visible outside the team?`,
      `Which of these are worth building a bench for now, versus accepting the risk deliberately?`,
    ],
    falsifier: () => `Evidence that at least one flagged role already has a trained backup or a documented handover process.`,
    dataAsk: () => `Whether a succession or handover plan already exists for any of the flagged roles — Atlas can only see the org chart, not the plan.`,
  },
  "control-gap": {
    questions: () => [
      `Is this mandated role genuinely missing, or is it held by someone whose title Atlas's register doesn't recognise?`,
      `Who is currently performing this function informally, if anyone?`,
      `What is the compliance exposure of this gap remaining open through the next reporting cycle?`,
    ],
    falsifier: () => `Someone currently holding this function under a title the protected-role register doesn't yet recognise.`,
    dataAsk: () => `Confirmation from governance or compliance on whether this role is genuinely unfilled, or filled under an unrecognised title.`,
  },
  "function-investment-variance": {
    questions: () => [
      `Is the variance here genuine under- or over-investment, or a reference band that doesn't fit this organisation's model?`,
      `What would this function look like if it were resourced at the reference band exactly?`,
      `Has anyone tested whether the gap correlates with a service-quality or delivery-speed difference?`,
    ],
    falsifier: () => `A sector-adjusted reason this function's size is defensible against the reference band as it stands.`,
    dataAsk: () => `A statement of what this function is actually resourced to deliver, to test the reference band against a real service commitment rather than headcount alone.`,
  },
};

const GENERIC_COPY: ArchetypeCopy = {
  questions: (h) => [
    `What in ${subject(h)} would need to be true for this to be worth acting on?`,
    `Who in the room would push back on this reading, and on what evidence?`,
    `Is this the highest-value thing to raise about ${subject(h)}, or the easiest to compute?`,
  ],
  falsifier: (h) => `Evidence specific to ${subject(h)} that directly contradicts the figures in this hypothesis's own evidence block.`,
  dataAsk: () => `Nothing further needed — this reading is already computed directly from the establishment.`,
};

export interface HypothesisEnrichment {
  archetypes: Archetype[];
  confidenceGrade: "high" | "medium" | "low";
  provokingQuestions: string[];
  falsifier: string;
  dataAsk: string;
}

export function enrich(h: Hypothesis): HypothesisEnrichment {
  const archetypes = classifyArchetype(h);
  const copy = archetypes.length > 0 ? COPY[archetypes[0]] : GENERIC_COPY;
  // A client-supplied belief or target already states its own data ask via
  // "needs-input" — the action field already names the concrete unlock, so
  // reuse it rather than draft a second, possibly contradictory one.
  const dataAsk = h.strength === "needs-input" ? h.action : copy.dataAsk(h);
  return {
    archetypes,
    confidenceGrade: gradeConfidence(h),
    provokingQuestions: copy.questions(h),
    falsifier: copy.falsifier(h),
    dataAsk,
  };
}
