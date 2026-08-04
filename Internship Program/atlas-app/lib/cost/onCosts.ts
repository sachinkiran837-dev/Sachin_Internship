import onCostConfig from "@/config/on-costs.json";
import type { Position } from "@/lib/graph/types";

interface OnCostRates {
  superannuationRate: number;
  leaveLoadingRate: number;
  payrollTaxRate: number;
  workersCompRate: number;
}

const RATES: OnCostRates = onCostConfig;

/** Combined on-cost loading over the base rate — superannuation, leave loading, payroll tax, workers comp. */
export const ON_COST_LOADING_RATE =
  RATES.superannuationRate + RATES.leaveLoadingRate + RATES.payrollTaxRate + RATES.workersCompRate;

export interface LoadedCost {
  /** The ingested cost × FTE, unmodified — what the rest of the app calls "cost" today. */
  baseCost: number;
  /** Base cost plus superannuation, leave loading, payroll tax and workers compensation. */
  fullyLoadedCost: number;
  loadingRate: number;
  basis: string;
}

/**
 * A3: the fully-loaded annual cost of one position, on top of whatever the
 * ingested cost column holds. The A3 honesty rule is that a headline dollar
 * figure states its basis rather than leaving "cost" ambiguous between a base
 * rate and a fully-loaded one — this is the deterministic normalization every
 * other cost figure in the diagnostic should eventually read through.
 *
 * Additive for this phase: existing screens and plays keep reading `cost *
 * fte` (the base rate) exactly as before, since rewiring every dollar figure
 * in the app to the loaded rate is a larger, separately-reviewable change.
 * This is the shared utility for wherever a fully-loaded figure is wanted now
 * (the Findings-level total), and for later phases to adopt more broadly.
 */
export function loadedCost(position: Pick<Position, "cost" | "fte">): LoadedCost {
  const baseCost = position.cost * position.fte;
  const fullyLoadedCost = baseCost * (1 + ON_COST_LOADING_RATE);
  return {
    baseCost,
    fullyLoadedCost,
    loadingRate: ON_COST_LOADING_RATE,
    basis: `+${(ON_COST_LOADING_RATE * 100).toFixed(1)}% on-costs (super, leave loading, payroll tax, workers comp) over the ingested base rate`,
  };
}

export function totalFullyLoadedCost(positions: Position[]): number {
  return positions.reduce((sum, p) => sum + loadedCost(p).fullyLoadedCost, 0);
}
