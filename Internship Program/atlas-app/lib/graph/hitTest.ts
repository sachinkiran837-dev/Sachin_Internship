export interface HitCandidate {
  id: string;
  x: number;
  y: number;
}

const TIEBREAK_EPSILON = 0.5;

/**
 * Nearest-neighbour hit test for drag-to-reassign: closest visible,
 * non-dimmed node centre within a distance threshold. Equidistant
 * candidates resolve deterministically (lowest id wins) rather than
 * picking whichever the pointer library happened to iterate first.
 */
export function nearestCandidate(
  dragged: HitCandidate,
  candidates: HitCandidate[],
  maxDistance: number
): string | null {
  let best: { id: string; distance: number }[] = [];

  for (const c of candidates) {
    const distance = Math.hypot(c.x - dragged.x, c.y - dragged.y);
    if (distance > maxDistance) continue;

    if (best.length === 0 || distance < best[0].distance - TIEBREAK_EPSILON) {
      best = [{ id: c.id, distance }];
    } else if (Math.abs(distance - best[0].distance) <= TIEBREAK_EPSILON) {
      best.push({ id: c.id, distance });
    }
  }

  if (best.length === 0) return null;
  return [...best].sort((a, b) => (a.id < b.id ? -1 : 1))[0].id;
}
