import archetypeConfig from "@/config/function-archetypes.json";
import { tagNodes } from "@/lib/graph/tagging";
import { divisionOf } from "@/lib/analysis/functions";
import type { LayoutNode, Position } from "@/lib/graph/types";

/**
 * c1-centralization-assessment: where each corporate function's footprint
 * actually sits, and a trade-off case for where it should sit.
 *
 * Reuses the function-group rollup Module B already relies on rather than
 * inventing a second grouping — a "function" here is the same Finance,
 * Operations, People bucket the structure diagnostics compare by. What's new
 * is the second cut inside each function: by site where a file supplied one,
 * and by division (the tree-branch cut `analyseFunctions` already computes)
 * always, since that's available on every establishment regardless of
 * whether it carries site data.
 *
 * Distributed clinical presence is excluded before anything here runs, per
 * the skill's own rule — a 30-site aged-care roster is not a footprint
 * finding, it's the organisation doing its job.
 */

export type WorkArchetype = "transactional" | "advisory" | "site-operational";

export type OperatingModelPattern =
  | "centralized"
  | "federated"
  | "hub-and-spoke"
  | "shared service plus business partner";

interface ArchetypeEntry {
  archetype: WorkArchetype;
  rationale: string;
}

const ARCHETYPES: { groups: Record<string, ArchetypeEntry>; default: ArchetypeEntry } = archetypeConfig as {
  groups: Record<string, ArchetypeEntry>;
  default: ArchetypeEntry;
};

export interface FootprintInstance {
  key: string;
  headcount: number;
  cost: number;
  managers: number;
  averageSpan: number;
  layers: number;
  /** So c2-duplication-detection can exclude these before pricing a consolidation. */
  protectedCount: number;
  protectedCost: number;
}

export interface TradeOffCase {
  forCentralizing: string;
  forLocal: string;
}

export interface FunctionFootprint {
  functionGroup: string;
  archetype: WorkArchetype;
  archetypeRationale: string;
  headcount: number;
  cost: number;
  /** Whether any position in this function carries a site value. False means the site cut below is a single "no site data" instance. */
  hasSiteData: boolean;
  bySite: FootprintInstance[];
  /** Always available — the tree-branch cut, standing in for "business unit" until a real field exists. */
  byDivision: FootprintInstance[];
  tradeOff: TradeOffCase;
  /** Null when there's only one instance org-wide — nothing to recommend a pattern for. */
  recommendedPattern: OperatingModelPattern | null;
  patternRationale: string;
}

export interface FootprintResult {
  functions: FunctionFootprint[];
  /** Positions excluded because they're clinical — never a footprint or duplication finding. */
  clinicalExcludedCount: number;
}

const NO_SITE = "(no site data)";

function archetypeFor(functionGroup: string): ArchetypeEntry {
  return ARCHETYPES.groups[functionGroup] ?? ARCHETYPES.default;
}

function instanceOf(key: string, members: LayoutNode[]): FootprintInstance {
  const headcount = members.length;
  const cost = members.reduce((s, n) => s + n.cost * n.fte, 0);
  const managers = members.filter((n) => n.childIds.length > 0);
  const depths = members.map((n) => n.depth);
  const protectedMembers = members.filter((n) => n.flags.protected);

  return {
    key,
    headcount,
    cost,
    managers: managers.length,
    averageSpan:
      managers.length === 0
        ? 0
        : managers.reduce((s, n) => s + n.childIds.length, 0) / managers.length,
    layers: headcount === 0 ? 0 : Math.max(...depths) - Math.min(...depths) + 1,
    protectedCount: protectedMembers.length,
    protectedCost: protectedMembers.reduce((s, n) => s + n.cost * n.fte, 0),
  };
}

function groupInto(members: LayoutNode[], keyOf: (n: LayoutNode) => string): FootprintInstance[] {
  const groups = new Map<string, LayoutNode[]>();
  for (const m of members) {
    const key = keyOf(m);
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups.entries()]
    .map(([key, group]) => instanceOf(key, group))
    .sort((a, b) => b.cost - a.cost);
}

/**
 * The trade-off case per archetype, stated so a client sees the reasoning
 * rather than a bare label — per the skill's own rule that a verdict without
 * its case is not usable in a room.
 */
function tradeOffFor(archetype: WorkArchetype, functionGroup: string, instances: number): TradeOffCase {
  const scale = instances > 1 ? `run ${instances} times over across this establishment` : "run once, today";
  return {
    forCentralizing: `Scale and standardisation: ${functionGroup} being ${scale} is the case for one process, one system and one set of controls rather than several.`,
    forLocal: `Responsiveness and local knowledge: keeping ${functionGroup.toLowerCase()} close to where the work happens preserves single-point accountability and the judgment a standard process can't encode — the case that matters most for ${
      archetype === "site-operational" ? "operational, site-specific work" : archetype === "advisory" ? "advisory work that has to read local context" : "work with real local variation"
    }.`,
  };
}

function patternFor(
  archetype: WorkArchetype,
  siteInstances: number
): { pattern: OperatingModelPattern | null; rationale: string } {
  if (siteInstances <= 1) {
    return {
      pattern: null,
      rationale: "Only one instance of this function exists in the establishment as read — there's no footprint to recommend an operating-model pattern for.",
    };
  }

  if (archetype === "transactional") {
    return {
      pattern: "shared service plus business partner",
      rationale: `Transactional work standardises well and is currently split across ${siteInstances} sites — the textbook fit is one shared-service centre running the process, with a thin local business-partner layer for exceptions.`,
    };
  }
  if (archetype === "site-operational") {
    return {
      pattern: "federated",
      rationale: `Site-operational work stays where the work is by nature — the recommendation is to keep it federated across the ${siteInstances} sites rather than force a central owner onto work that has to flex locally.`,
    };
  }
  return {
    pattern: "hub-and-spoke",
    rationale: `Advisory work hybridises: a small centre sets the standard and method, and local roles apply it in context across the ${siteInstances} sites where it currently runs.`,
  };
}

export function buildFootprint(positions: Position[], rootId: string | null): FootprintResult {
  const tagged = tagNodes(positions, rootId);
  const real = tagged.filter((n) => !n.synthetic);

  // Rule 5: distributed clinical presence is expected and excluded by
  // design, never surfaced as a footprint or duplication finding.
  const nonClinical = real.filter((n) => !n.clinicalFlag);
  const clinicalExcludedCount = real.length - nonClinical.length;

  const divisions = divisionOf(tagged, rootId);

  const byFunction = new Map<string, LayoutNode[]>();
  for (const n of nonClinical) {
    const list = byFunction.get(n.functionGroup) ?? [];
    list.push(n);
    byFunction.set(n.functionGroup, list);
  }

  const functions: FunctionFootprint[] = [...byFunction.entries()]
    .map(([functionGroup, members]) => {
      const { archetype, rationale } = archetypeFor(functionGroup);
      const hasSiteData = members.some((n) => n.site !== null && n.site.trim() !== "");

      const bySite = hasSiteData
        ? groupInto(members, (n) => n.site?.trim() || NO_SITE)
        : [instanceOf(NO_SITE, members)];
      const byDivision = groupInto(members, (n) => divisions.get(n.id) ?? "");

      const siteInstanceCount = hasSiteData ? bySite.length : 1;
      const { pattern, rationale: patternRationale } = patternFor(archetype, siteInstanceCount);

      return {
        functionGroup,
        archetype,
        archetypeRationale: rationale,
        headcount: members.length,
        cost: members.reduce((s, n) => s + n.cost * n.fte, 0),
        hasSiteData,
        bySite,
        byDivision,
        tradeOff: tradeOffFor(archetype, functionGroup, siteInstanceCount),
        recommendedPattern: pattern,
        patternRationale,
      };
    })
    .sort((a, b) => b.cost - a.cost);

  return { functions, clinicalExcludedCount };
}
