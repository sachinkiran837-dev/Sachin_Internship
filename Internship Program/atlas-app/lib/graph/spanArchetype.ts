import archetypeConfig from "@/config/span-archetypes.json";
import spanConfig from "@/config/span-thresholds.json";
import type { Position, SpanThresholds } from "./types";

/**
 * B1: which span-of-control band a manager's role is benchmarked against.
 * Distinct archetypes exist because a single universal band flags a
 * call-centre supervisor and a project director with the same ruler — one
 * of them is always going to be wrong.
 */
export interface SpanArchetype {
  id: string;
  label: string;
  healthyMin: number;
  healthyMax: number;
  /** The actual thin/wide boundary when it differs from the healthy band (e.g. professional work flags under 3, not under 6). */
  flagUnder?: number;
  flagOver?: number;
}

interface ArchetypeRule extends SpanArchetype {
  matchTitles: string[];
  matchFunctionGroups: string[];
}

const RULES = archetypeConfig.archetypes as ArchetypeRule[];
const DEFAULT_BAND: SpanThresholds = spanConfig;

/** Falls back to the organisation's own flat band — never an invented default. */
const DEFAULT_ARCHETYPE: SpanArchetype = {
  id: "professional",
  label: "Professional / knowledge work",
  healthyMin: DEFAULT_BAND.healthyMin,
  healthyMax: DEFAULT_BAND.healthyMax,
};

function matchesKeyword(haystack: string, keyword: string): boolean {
  const kw = keyword.toLowerCase();
  // Convention shared with function-groups.json: short keywords need a word
  // boundary, or "coo" matches inside an unrelated longer word.
  if (kw.length <= 3) {
    return new RegExp(`\\b${kw}\\b`).test(haystack);
  }
  return haystack.includes(kw);
}

function toArchetype(rule: ArchetypeRule): SpanArchetype {
  return {
    id: rule.id,
    label: rule.label,
    healthyMin: rule.healthyMin,
    healthyMax: rule.healthyMax,
    flagUnder: rule.flagUnder,
    flagOver: rule.flagOver,
  };
}

/** Which B1 archetype a role's span should be read against — title first, then function group. */
export function classifyArchetype(position: Pick<Position, "title" | "functionGroup">): SpanArchetype {
  const title = position.title.toLowerCase();

  for (const rule of RULES) {
    if (rule.matchTitles.some((kw) => matchesKeyword(title, kw))) return toArchetype(rule);
  }
  for (const rule of RULES) {
    if (rule.matchFunctionGroups.includes(position.functionGroup)) return toArchetype(rule);
  }
  return DEFAULT_ARCHETYPE;
}

export function listArchetypes(): SpanArchetype[] {
  return [...RULES.map(toArchetype), DEFAULT_ARCHETYPE];
}
