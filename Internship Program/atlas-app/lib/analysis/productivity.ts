import { isPublicHealthSector } from "@/lib/analysis/backOfficeBenchmarks";
import { totalRevenue, type BusinessContext } from "@/lib/hypothesis/context";
import type { DiagnosticMetrics } from "@/lib/graph/types";

/**
 * c4-productivity-ratios: workforce cost against output, in the sector's own
 * currency — held to the skill's hardest rule, that a ratio is never reported
 * as a productivity conclusion without the decomposition or the activity data
 * to back it.
 *
 * Atlas ingests one establishment snapshot at a time and holds no activity,
 * driver or price/volume history at all, so the honest output here is
 * narrower than the skill's full method: a raw ratio where the hypothesis
 * layer supplies revenue, clinical FTE where the roster/management
 * separation (A2/B1) has already run, and an explicit "not computable" for
 * everything that needs data this build doesn't capture — never a guessed
 * trend or an unearned productivity claim.
 */

export type ProductivityInstantiation = "commercial" | "public-health";

export interface ProductivityReading {
  instantiation: ProductivityInstantiation;
  /** Commercial: revenue per contracted FTE. Null without a supplied revenue figure. */
  revenuePerFte: number | null;
  /** Public-health: FTE carrying a clinical flag — the roster population, from A2. */
  clinicalFte: number | null;
  /** Always false in this build: no activity/driver data is ingested. */
  activityComputable: false;
  /** Always false: one snapshot per ingest, no longitudinal history. */
  trendComputable: false;
  safeStaffingNote: string;
  method: string;
}

const SAFE_STAFFING_NOTE =
  "Safe-staffing instruments are a hard floor, not an efficiency dial. Every scenario play and the guardrail " +
  "engine already exclude clinical and protected roles from removal or reassignment (see moves.ts's isTouchable) " +
  "— nothing in this build can generate a reading that implies breaching one.";

export function computeProductivity(metrics: DiagnosticMetrics, business: BusinessContext): ProductivityReading {
  const instantiation: ProductivityInstantiation = isPublicHealthSector(business) ? "public-health" : "commercial";
  const revenue = totalRevenue(business);

  return {
    instantiation,
    revenuePerFte:
      instantiation === "commercial" && revenue !== null && metrics.totalFte > 0
        ? revenue / metrics.totalFte
        : null,
    clinicalFte: instantiation === "public-health" ? metrics.clinicalFte : null,
    activityComputable: false,
    trendComputable: false,
    safeStaffingNote: SAFE_STAFFING_NOTE,
    method:
      "Revenue-per-FTE and activity-per-clinical-FTE are shown as raw ratios only. Atlas holds one establishment " +
      "snapshot per ingest with no price/volume or activity history, so neither a price-versus-productivity " +
      "decomposition (commercial) nor a cost-per-weighted-activity-unit (public-health) can be computed — reporting " +
      "either as a productivity conclusion without that data is exactly what the skill spec rules out.",
  };
}
