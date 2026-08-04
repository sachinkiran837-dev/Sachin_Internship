import { baseTitle } from "@/lib/analysis/titleKey";
import type { Position } from "@/lib/graph/types";

export interface CostEstimate {
  amount: number;
  /** Always "est." per A3's honesty rule — an estimate must never look like a recorded figure. */
  basis: string;
  peerCount: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * A3: an estimated cost for a position the export left unpriced, from the
 * median of other positions sharing the same underlying role (title is used
 * as a proxy for "classification" — a proper grade/classification field is a
 * later-phase schema addition). Always flagged "est." and never substituted
 * for a real figure in a comparison that depends on knowing what's recorded
 * versus assumed: `lib/analysis/functions.ts` deliberately excludes unpriced
 * positions from its medians, and this estimate must not quietly undo that —
 * it exists for A3's own "size what we can, flag what we assumed" purpose
 * (e.g. a Findings-level estimate of what's missing), not as a silent backfill.
 */
export function estimateCostFromPeers(
  position: Pick<Position, "id" | "title">,
  positions: Position[]
): CostEstimate | null {
  const key = baseTitle(position.title);
  const peers = positions.filter((p) => p.id !== position.id && p.cost > 0 && baseTitle(p.title) === key);
  const amount = median(peers.map((p) => p.cost));
  if (amount === null) return null;

  return {
    amount,
    basis: `est. from ${peers.length} other position${peers.length === 1 ? "" : "s"} titled "${position.title}" (or its permanent/agency equivalent)`,
    peerCount: peers.length,
  };
}

/** Every unpriced position, with an estimate where enough peers exist to support one. */
export function estimateUnpriced(positions: Position[]): { position: Position; estimate: CostEstimate | null }[] {
  return positions.filter((p) => p.cost <= 0).map((position) => ({ position, estimate: estimateCostFromPeers(position, positions) }));
}
