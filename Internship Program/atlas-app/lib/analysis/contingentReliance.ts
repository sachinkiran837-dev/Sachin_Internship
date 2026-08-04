import bandsConfig from "@/config/contingent-reliance-bands.json";
import { tagNodes } from "@/lib/graph/tagging";
import { analysePlay } from "@/lib/scenario/plays";
import type { UnitComparison } from "@/lib/analysis/functions";
import type { VacancyHygieneResult } from "@/lib/analysis/vacancyHygiene";
import type { Position } from "@/lib/graph/types";

/**
 * d1-agency-contingent-reliance: where reliance on agency/contingent labour
 * has become structural rather than surge cover, and what that costs against
 * the permanent equivalent — bounded honestly, never asserted as fully
 * recoverable.
 *
 * The premium figure is not recomputed here: `lib/scenario/plays.ts`'s
 * agency-premium play already benchmarks every contingent role against this
 * organisation's own permanent equivalent, and re-deriving that arithmetic a
 * second time is how two screens quietly disagree about the same number.
 * This module only re-groups that play's candidates by function.
 */

type Verdict = "in-line" | "elevated" | "structural";

function verdictFor(share: number): Verdict {
  if (share >= bandsConfig.structuralThreshold) return "structural";
  if (share > bandsConfig.peerBandMax) return "elevated";
  return "in-line";
}

export interface ContingentUnitReading {
  functionGroup: string;
  headcount: number;
  agencyCount: number;
  agencyShare: number;
  verdict: Verdict;
  /** From the agency-premium play's own benchmarking — 0 where none of this unit's contingent roles priced above their permanent equivalent. */
  premium: number;
  /** D2's vacancy rate for the same unit, when supplied — the overlay that tells structural reliance from a roster gap. */
  vacancyRate: number | null;
}

export interface ContingentRelianceResult {
  overall: { headcount: number; agencyCount: number; agencyShare: number; verdict: Verdict; totalPremium: number };
  byShare: ContingentUnitReading[];
  byPremium: ContingentUnitReading[];
  /** False when the two rankings disagree on which unit is the worst — surfaced rather than hidden, per the skill's own rule. */
  rankingsAgree: boolean;
  premiumIsEstimate: boolean;
}

export function buildContingentReliance(
  positions: Position[],
  rootId: string | null,
  comparison: UnitComparison,
  vacancy?: VacancyHygieneResult
): ContingentRelianceResult {
  const premiumAnalysis = analysePlay("agency-premium", positions, rootId);
  const tagged = tagNodes(positions, rootId).filter((n) => !n.synthetic);
  const deptToFunction = new Map(tagged.map((n) => [n.department, n.functionGroup] as const));
  const vacancyByUnit = new Map((vacancy?.byUnit ?? []).map((u) => [u.functionGroup, u.vacancyRate] as const));

  const premiumByUnit = new Map<string, number>();
  for (const c of premiumAnalysis?.candidates ?? []) {
    const fg = deptToFunction.get(c.department) ?? c.department;
    premiumByUnit.set(fg, (premiumByUnit.get(fg) ?? 0) + c.saving);
  }

  const units: ContingentUnitReading[] = comparison.units
    .filter((u) => u.headcount > 0)
    .map((u) => ({
      functionGroup: u.key,
      headcount: u.headcount,
      agencyCount: u.agency,
      agencyShare: u.agencyShare,
      verdict: verdictFor(u.agencyShare),
      premium: premiumByUnit.get(u.key) ?? 0,
      vacancyRate: vacancyByUnit.get(u.key) ?? null,
    }))
    .filter((u) => u.agencyCount > 0);

  const byShare = [...units].sort((a, b) => b.agencyShare - a.agencyShare);
  const byPremium = [...units].sort((a, b) => b.premium - a.premium);

  const totalHeadcount = tagged.length;
  const totalAgency = tagged.filter((n) => n.status === "contingent").length;
  const overallShare = totalHeadcount === 0 ? 0 : totalAgency / totalHeadcount;

  return {
    overall: {
      headcount: totalHeadcount,
      agencyCount: totalAgency,
      agencyShare: overallShare,
      verdict: verdictFor(overallShare),
      totalPremium: premiumAnalysis?.projectedSaving ?? 0,
    },
    byShare,
    byPremium,
    rankingsAgree: byShare.length === 0 || byShare[0].functionGroup === byPremium[0]?.functionGroup,
    premiumIsEstimate: (premiumAnalysis?.candidates.some((c) => c.rationale.includes("no permanent equivalent"))) ?? false,
  };
}

export const CONTINGENT_RELIANCE_METHOD =
  `${(bandsConfig.peerBandMin * 100).toFixed(0)}-${(bandsConfig.peerBandMax * 100).toFixed(0)}% contingent share reads as ` +
  `normal flexibility; above ${(bandsConfig.structuralThreshold * 100).toFixed(0)}% it reads as structural reliance, not surge ` +
  `cover — engagement-configurable peer bands, not this organisation's own median. The premium is the ceiling, priced against ` +
  `this org's own permanent equivalent where one exists; how much of it is actually recoverable is a conversion-feasibility ` +
  `judgment this engine does not make on its own.`;
