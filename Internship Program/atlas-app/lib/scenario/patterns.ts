import { checkCycle, checkPostChangeSpan, checkProtected, checkRoot, checkRosterExempt, checkSynthetic, type GuardResult } from "./guardrails";
import { isRosterMember } from "./moves";
import { tagNodes } from "@/lib/graph/tagging";
import type { ParsedMove } from "./moveParser";
import type { Move, MoveKind, Position } from "@/lib/graph/types";

/**
 * h1-redesign-pattern-library: the fixed vocabulary every scenario move
 * compiles against, whether typed or dragged. Atlas already has the actual
 * mutation primitives (`lib/scenario/moves.ts`), ten priced plays
 * (`plays.ts`) and a deterministic instruction parser (`moveParser.ts`) —
 * this module is the naming and provenance layer over them, not a
 * replacement: it tags what each existing play and parsed instruction
 * *means* against the skill spec's seven named patterns, runs the full
 * guardrail checklist (not just first-failure) for audit purposes, and
 * lowers the result to the three-primitive change-set vocabulary
 * `h2-scenario-impact-modeling` reads.
 */

export type NamedPattern =
  | "collapse-layer"
  | "remove-single-report-chain"
  | "widen-span"
  | "consolidate-to-shared-service"
  | "agency-to-permanent-conversion"
  | "rebalance-mix"
  | "redistribute-center-site";

export interface PatternMeta {
  id: NamedPattern;
  label: string;
  mechanic: string;
  /** Which of the existing plays already implement this pattern — [] means the pattern is named by the spec but nothing in this build acts on it yet. */
  sourcePlays: string[];
  /** A management-chain pattern is exactly the set H1's roster exemption applies to — collapse-layer, remove-single-report-chain, consolidate-to-shared-service. Widen-span deliberately is not one: rebalancing reports between roster leads is a legitimate roster operation, not a chain reaching into one (see wide-span-redistribution). */
  managementChain: boolean;
}

export const PATTERN_LIBRARY: PatternMeta[] = [
  {
    id: "collapse-layer",
    label: "Collapse layer",
    mechanic: "Lift reports one level, shortening the path from division head to frontline.",
    sourcePlays: ["deep-chain-compression"],
    managementChain: true,
  },
  {
    id: "remove-single-report-chain",
    label: "Remove single-report chain",
    mechanic: "Remove a management role supervising exactly one management report.",
    sourcePlays: ["pass-through-layers", "manager-ratio"],
    managementChain: true,
  },
  {
    id: "widen-span",
    label: "Widen span",
    mechanic: "Merge sibling teams, or redistribute reports, under the stronger structure.",
    sourcePlays: ["thin-span-consolidation", "wide-span-redistribution"],
    managementChain: false,
  },
  {
    id: "consolidate-to-shared-service",
    label: "Consolidate to shared service",
    mechanic: "The most senior holder absorbs the function; duplicated management is removed.",
    sourcePlays: ["shared-service"],
    managementChain: true,
  },
  {
    id: "agency-to-permanent-conversion",
    label: "Agency-to-permanent conversion",
    mechanic: "Convert contingent positions to permanent equivalents at the same classification.",
    sourcePlays: ["agency-premium", "contractor-insourcing"],
    managementChain: false,
  },
  {
    id: "rebalance-mix",
    label: "Rebalance mix",
    mechanic: "Shift classification or skill mix within a unit.",
    sourcePlays: [],
    managementChain: false,
  },
  {
    id: "redistribute-center-site",
    label: "Redistribute centre-to-site or site-to-centre",
    mechanic: "Move a function's reporting destination along the centralization spectrum.",
    sourcePlays: [],
    managementChain: false,
  },
];

const PLAY_TO_PATTERN: Record<string, NamedPattern> = {};
for (const p of PATTERN_LIBRARY) for (const playId of p.sourcePlays) PLAY_TO_PATTERN[playId] = p.id;

/** Which named pattern a play implements — null for plays that don't cleanly match one of the seven (vacancy-rationalisation, shadow-roles: real plays, just not one of these named patterns). */
export function patternForPlay(playId: string): NamedPattern | null {
  return PLAY_TO_PATTERN[playId] ?? null;
}

export function patternMeta(id: NamedPattern): PatternMeta {
  return PATTERN_LIBRARY.find((p) => p.id === id)!;
}

const MOVE_KIND_TO_PATTERN: Partial<Record<ParsedMove["kind"], NamedPattern>> = {
  flatten: "collapse-layer",
  merge: "consolidate-to-shared-service",
};

/**
 * A typed instruction's move kind, mapped where it's unambiguous. "remove"
 * and "reassign" are deliberately not mapped here — a bare remove or
 * reassign could be any of several patterns (or none) depending on the
 * target's own shape (a single-report manager vs. anything else), which
 * `guardrailLogForRemove`/`guardrailLogForReassign` resolve against the
 * actual graph rather than the instruction text alone.
 */
export function patternForParsedMove(parsed: ParsedMove): NamedPattern | null {
  return MOVE_KIND_TO_PATTERN[parsed.kind] ?? null;
}

/**
 * Step 5's honest-fail path: an instruction `moveParser.ts` couldn't
 * recognise at all still gets a best-guess nearest pattern from keywords,
 * so the rejection names something rather than just saying no.
 */
const NEAREST_PATTERN_KEYWORDS: { pattern: NamedPattern; keywords: string[] }[] = [
  { pattern: "collapse-layer", keywords: ["flatten", "layer", "collapse"] },
  { pattern: "remove-single-report-chain", keywords: ["single report", "single-report", "pass-through", "pass through"] },
  { pattern: "widen-span", keywords: ["span", "widen", "redistribute"] },
  { pattern: "consolidate-to-shared-service", keywords: ["merge", "consolidate", "shared service"] },
  { pattern: "agency-to-permanent-conversion", keywords: ["agency", "contract", "convert", "permanent"] },
  { pattern: "rebalance-mix", keywords: ["mix", "classification", "grade", "seniority"] },
  { pattern: "redistribute-center-site", keywords: ["site", "centralise", "centralize", "decentralise", "decentralize"] },
];

export function nearestPatternForText(raw: string): NamedPattern | null {
  const t = raw.toLowerCase();
  for (const { pattern, keywords } of NEAREST_PATTERN_KEYWORDS) {
    if (keywords.some((k) => t.includes(k))) return pattern;
  }
  return null;
}

export interface CompileRejection {
  compiled: false;
  reason: string;
  nearestPattern: NamedPattern | null;
}

/** The rejection response for an instruction `moveParser.ts` returned "unrecognized" for — names the nearest pattern rather than inventing a move. */
export function rejectWithNearestPattern(raw: string): CompileRejection {
  const nearest = nearestPatternForText(raw);
  return {
    compiled: false,
    reason: nearest
      ? `Couldn't compile "${raw}" to an exact move — it reads closest to "${patternMeta(nearest).label}" (${patternMeta(nearest).mechanic}). Try stating it as that pattern directly.`
      : `Couldn't compile "${raw}" to any of the seven named patterns. Available patterns: ${PATTERN_LIBRARY.map((p) => p.label).join(", ")}.`,
    nearestPattern: nearest,
  };
}

/* ------------------------------------------------------------------ */
/* Primitive lowering + provenance                                     */
/* ------------------------------------------------------------------ */

export type PrimitiveKind = "remove-role" | "move-node" | "collapse-layer";
/**
 * Atlas's real mutation engine has two operation kinds the spec's own
 * three-primitive vocabulary doesn't name: rebasing a role's cost/status
 * (agency-to-permanent conversion, in-housing) and adding a new role. Both
 * are kept as their own kind rather than force-labelled into `move-node` or
 * `remove-role`, which would misrepresent what actually happened.
 */
export type ExtendedPrimitiveKind = PrimitiveKind | "rebase-cost" | "add-role";

export interface ChangeSetPrimitive {
  kind: ExtendedPrimitiveKind;
  positionId: string;
  detail: string;
}

export interface GuardrailCheckEntry {
  name: string;
  passed: boolean;
  reason?: string;
}

export interface Provenance {
  pattern: NamedPattern | null;
  triggeredBy: "instruction" | "drag" | "play";
  raw: string;
}

export interface CompiledChangeSet {
  compiled: true;
  primitives: ChangeSetPrimitive[];
  guardrailLog: GuardrailCheckEntry[];
  provenance: Provenance;
}

/** MoveKind -> the primitive it lowers to, for the four kinds that map 1:1. */
const MOVE_KIND_PRIMITIVE: Partial<Record<MoveKind, ExtendedPrimitiveKind>> = {
  remove: "remove-role",
  reassign: "move-node",
  rebase: "rebase-cost",
  add: "add-role",
  flatten: "collapse-layer",
};

/** Lowers a recorded Move (already applied, from the audit trail) to its primitive — the representation h2-scenario-impact-modeling reads, regardless of whether it arrived typed, dragged or as a play. */
export function moveToPrimitive(move: Move, positionId: string): ChangeSetPrimitive | null {
  const kind = MOVE_KIND_PRIMITIVE[move.kind];
  if (!kind) return null;
  return { kind, positionId, detail: move.description };
}

/**
 * The full guardrail checklist for a proposed reassignment, run for
 * provenance/audit purposes — every check named, passed or not, not just
 * the first failure. The actual mutation still runs through
 * `lib/scenario/moves.ts`'s `reassign`, which is the single source of truth
 * for whether a move is actually blocked; this log exists so a change-set
 * can show its full working, per H1's step 5.
 */
export function guardrailLogForReassign(
  positions: Position[],
  rootId: string | null,
  positionId: string,
  newManagerId: string,
  pattern: NamedPattern | null
): GuardrailCheckEntry[] {
  const position = positions.find((p) => p.id === positionId);
  const log: GuardrailCheckEntry[] = [];
  const push = (name: string, result: GuardResult) => log.push({ name, passed: !result.blocked, reason: result.reason });

  push("not the root position", checkRoot(positionId, rootId));
  if (position) push("not a synthetic heading", checkSynthetic(position));
  if (position) {
    const tagged = tagNodes(positions, rootId).find((n) => n.id === positionId);
    push("not a protected role", checkProtected(position, tagged?.flags.unitRoster ?? false));
  }
  push("no reporting-line cycle", checkCycle(positions, positionId, newManagerId));

  const managementChain = pattern ? patternMeta(pattern).managementChain : false;
  push(
    "not a roster member (management-chain patterns only)",
    managementChain ? checkRosterExempt(isRosterMember(positions, rootId, positionId), pattern ? patternMeta(pattern).label : "management-chain") : { blocked: false }
  );

  const next = positions.map((p) => (p.id === positionId ? { ...p, managerId: newManagerId } : p));
  push("receiving manager stays inside their span ceiling", checkPostChangeSpan(next, rootId, newManagerId));

  return log;
}

export const H1_METHOD =
  "Every scenario move, typed or dragged, resolves to exactly one of seven named patterns or is rejected with the " +
  "nearest one — never invented on the spot. Every guardrail is checked and logged, not just the first failure, and a " +
  "management-chain pattern (collapse-layer, remove-single-report-chain, consolidate-to-shared-service) can never reach " +
  "a roster member; widen-span is deliberately exempt from that same check, because rebalancing reports between roster " +
  "leads is a legitimate roster operation, not a chain reaching into one — a distinction this build got wrong on the " +
  "first pass and fixed after it blocked wide-span-redistribution's own candidates.";
