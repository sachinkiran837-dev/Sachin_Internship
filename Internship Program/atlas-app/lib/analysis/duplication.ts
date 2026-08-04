import bandConfig from "@/config/consolidation-band.json";
import type { FootprintInstance, FootprintResult, WorkArchetype } from "@/lib/analysis/footprint";

/**
 * c2-duplication-detection: which transactional functions are run more than
 * once across sites, and what consolidating them is soberly worth.
 *
 * Reads c1's footprint map rather than recomputing anything from positions —
 * the shared-object contract the two skills are specified to have. Real
 * duplication versus a naming artefact is a semantic call the skill spec
 * marks as model-call-and-human-confirmed; this always surfaces the raw
 * per-site breakdown as the evidence for that call rather than asserting one,
 * and prices every qualifying candidate as "pending confirmation" rather than
 * as a settled finding.
 */

interface BandConfig {
  captureBandMin: number;
  captureBandMax: number;
  minInstanceHeadcount: number;
  eligibleArchetypes: WorkArchetype[];
}
const BAND: BandConfig = bandConfig as BandConfig;

export interface DuplicationCandidate {
  functionGroup: string;
  archetype: WorkArchetype;
  instances: FootprintInstance[];
  combinedHeadcount: number;
  /** Total cost across qualifying instances, protected roles excluded. */
  combinedCost: number;
  protectedExcludedCount: number;
  protectedExcludedCost: number;
  captureLow: number;
  captureHigh: number;
}

/**
 * The functions worth pricing as duplication: a transactional-archetype
 * function present in two or more site instances that each clear the
 * minimum size to be a real build-out rather than a stray hire.
 */
export function findDuplicatedFunctions(footprint: FootprintResult): DuplicationCandidate[] {
  return footprint.functions
    .filter((f) => f.hasSiteData && BAND.eligibleArchetypes.includes(f.archetype))
    .map((f) => ({
      ...f,
      qualifying: f.bySite.filter((i) => i.headcount >= BAND.minInstanceHeadcount),
    }))
    .filter((f) => f.qualifying.length >= 2)
    .map((f) => {
      const protectedExcludedCount = f.qualifying.reduce((s, i) => s + i.protectedCount, 0);
      const protectedExcludedCost = f.qualifying.reduce((s, i) => s + i.protectedCost, 0);
      const combinedCost = f.qualifying.reduce((s, i) => s + i.cost, 0) - protectedExcludedCost;

      return {
        functionGroup: f.functionGroup,
        archetype: f.archetype,
        instances: f.qualifying.sort((a, b) => b.cost - a.cost),
        combinedHeadcount: f.qualifying.reduce((s, i) => s + i.headcount, 0) - protectedExcludedCount,
        combinedCost,
        protectedExcludedCount,
        protectedExcludedCost,
        captureLow: combinedCost * BAND.captureBandMin,
        captureHigh: combinedCost * BAND.captureBandMax,
      };
    })
    .sort((a, b) => b.combinedCost - a.combinedCost);
}

export const CONSOLIDATION_METHOD =
  `Only transactional functions present as ${BAND.minInstanceHeadcount}+ positions in two or more sites are scanned — ` +
  `site-operational and clinical presence are excluded by design, and a single stray hire at a satellite site is not ` +
  `a build-out. Every candidate needs confirming as real duplication rather than a naming artefact before the price ` +
  `means anything, which is why it is shown alongside the per-site breakdown rather than as a settled figure. The ` +
  `priced range is ${(BAND.captureBandMin * 100).toFixed(0)}-${(BAND.captureBandMax * 100).toFixed(0)}% of the ` +
  `combined cost, protected roles excluded — never the whole duplicated cost, because some of it is genuine local variation.`;
