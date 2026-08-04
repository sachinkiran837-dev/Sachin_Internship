import bandsConfig from "@/config/back-office-bands.json";
import sectorConfig from "@/config/sector-archetypes.json";
import { UNCLASSIFIED } from "@/lib/graph/types";
import type { UnitComparison } from "@/lib/analysis/functions";
import { totalRevenue, type BusinessContext } from "@/lib/hypothesis/context";

/**
 * c3-back-office-efficiency-benchmarks: is each corporate function's size
 * defensible against a sector-adjusted reference, correcting for the two
 * ways a function can look leaner than it is.
 *
 * Reuses `analyseFunctions`'s function-level cut rather than the site-level
 * footprint — this skill's ratios (cost share, FTE per 100) are whole-of-
 * function figures, and the self-relative engine already carries the
 * denominators (organisation-wide FTE and cost) and the agency share this
 * skill's outsourcing caveat depends on.
 */

type BandKind = "fte-per-100" | "percent-of-revenue" | "none";

interface FteBand {
  label: string;
  kind: "fte-per-100";
  min: number;
  max: number;
  note: string;
}
interface RevenueBand {
  label: string;
  kind: "percent-of-revenue";
  commercial: { min: number; max: number };
  note: string;
}
interface NoBand {
  label: string;
  kind: "none";
  note: string;
}
type BandConfig = FteBand | RevenueBand | NoBand;

const BANDS: Record<string, BandConfig> = bandsConfig as unknown as Record<string, BandConfig>;

export function isPublicHealthSector(business: BusinessContext): boolean {
  const sector = (business.sector ?? "").toLowerCase();
  return sectorConfig.publicHealthKeywords.some((k) => sector.includes(k));
}

export type BandVerdict = "over" | "in line" | "under" | "not computable";

export interface BackOfficeReading {
  functionGroup: string;
  bandKind: BandKind;
  bandLabel: string | null;
  costShare: number;
  fteShare: number;
  fteFor100: number;
  verdict: BandVerdict;
  /** The band read, worded for a screen ("1.0-1.4 FTE per 100 FTE"). Null when there's nothing to compare against. */
  bandStatement: string | null;
  /** Set when the function looks lean partly because of agency/contingent reliance, per the skill's own cross-check. */
  outsourcingCaveat: string | null;
}

const OUTSOURCING_CAVEAT_THRESHOLD = 0.15;

function outsourcingCaveat(functionGroup: string, agencyShare: number, verdict: BandVerdict): string | null {
  if (verdict !== "under" || agencyShare < OUTSOURCING_CAVEAT_THRESHOLD) return null;
  return (
    `${functionGroup} reads lean partly because ${(agencyShare * 100).toFixed(0)}% of its headcount is agency or ` +
    `contingent — check what's been pushed outside the establishment count before treating this as under-invested.`
  );
}

export function benchmarkFunctions(
  comparison: UnitComparison,
  business: BusinessContext,
  totalFte: number
): BackOfficeReading[] {
  return comparison.units
    .filter((u) => u.key !== UNCLASSIFIED && u.key.trim() !== "")
    .map((u) => {
      const band = BANDS[u.key];
      const fteFor100 = totalFte > 0 ? (u.fte / totalFte) * 100 : 0;

      if (!band || band.kind === "none") {
        return {
          functionGroup: u.key,
          bandKind: "none" as const,
          bandLabel: band?.label ?? null,
          costShare: u.costShare,
          fteShare: u.headcountShare,
          fteFor100,
          verdict: "not computable" as const,
          bandStatement: band?.note ?? null,
          outsourcingCaveat: null,
        };
      }

      if (band.kind === "fte-per-100") {
        const verdict: BandVerdict = fteFor100 < band.min ? "under" : fteFor100 > band.max ? "over" : "in line";
        return {
          functionGroup: u.key,
          bandKind: "fte-per-100" as const,
          bandLabel: band.label,
          costShare: u.costShare,
          fteShare: u.headcountShare,
          fteFor100,
          verdict,
          bandStatement: `${band.min.toFixed(1)}-${band.max.toFixed(1)} FTE per 100 organisational FTE`,
          outsourcingCaveat: outsourcingCaveat(u.key, u.agencyShare, verdict),
        };
      }

      // percent-of-revenue (Finance)
      if (isPublicHealthSector(business)) {
        return {
          functionGroup: u.key,
          bandKind: "percent-of-revenue" as const,
          bandLabel: band.label,
          costShare: u.costShare,
          fteShare: u.headcountShare,
          fteFor100,
          verdict: "not computable" as const,
          bandStatement:
            "Public-health finance has a sector-specific variant with no single default — read against your own funding model rather than a commercial band.",
          outsourcingCaveat: null,
        };
      }

      const revenue = totalRevenue(business);
      if (revenue === null || revenue <= 0) {
        return {
          functionGroup: u.key,
          bandKind: "percent-of-revenue" as const,
          bandLabel: band.label,
          costShare: u.costShare,
          fteShare: u.headcountShare,
          fteFor100,
          verdict: "not computable" as const,
          bandStatement: `${(band.commercial.min * 100).toFixed(1)}-${(band.commercial.max * 100).toFixed(1)}% of revenue — supply group revenue in the business context to compute this.`,
          outsourcingCaveat: null,
        };
      }

      const shareOfRevenue = u.cost / revenue;
      const verdict: BandVerdict =
        shareOfRevenue < band.commercial.min ? "under" : shareOfRevenue > band.commercial.max ? "over" : "in line";
      return {
        functionGroup: u.key,
        bandKind: "percent-of-revenue" as const,
        bandLabel: band.label,
        costShare: shareOfRevenue,
        fteShare: u.headcountShare,
        fteFor100,
        verdict,
        bandStatement: `${(band.commercial.min * 100).toFixed(1)}-${(band.commercial.max * 100).toFixed(1)}% of revenue`,
        outsourcingCaveat: outsourcingCaveat(u.key, u.agencyShare, verdict),
      };
    });
}

export const BACK_OFFICE_METHOD =
  "Reference bands are sector-adjusted external constants, not this organisation's own median — the one place Atlas " +
  "reads a function against an outside number rather than against itself. A function with no band configured, or " +
  "missing the revenue or sector data a band needs, reads as 'not computable' rather than a guessed verdict.";
