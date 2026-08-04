import type { LayoutNode, ShapeProfile } from "@/lib/graph/types";

/**
 * B4: reads the silhouette of the organisation — where headcount and
 * management pool by layer — rather than a single group-wide ratio, which
 * hides exactly the pattern this is meant to catch. A pyramid narrows
 * cleanly toward the top; a diamond pools headcount and management in the
 * middle layers (seniority drift, coordination pooling); an hourglass is
 * thin in the middle with headcount at both the top and the bottom (a
 * missing middle).
 */
export function classifyShape(nodes: LayoutNode[]): ShapeProfile {
  const real = nodes.filter((n) => !n.synthetic);
  const managers = real.filter((n) => n.childIds.length > 0);
  const ics = real.filter((n) => n.childIds.length === 0);

  const managerCost = managers.reduce((s, n) => s + n.cost * n.fte, 0);
  const totalCost = real.reduce((s, n) => s + n.cost * n.fte, 0);

  const depths = [...new Set(real.map((n) => n.depth))].sort((a, b) => a - b);
  const byLayer = depths.map((depth) => {
    const atLayer = real.filter((n) => n.depth === depth);
    const managersAtLayer = atLayer.filter((n) => n.childIds.length > 0);
    return {
      depth,
      headcount: atLayer.length,
      managerShare: atLayer.length === 0 ? 0 : managersAtLayer.length / atLayer.length,
    };
  });

  if (real.length === 0 || byLayer.length < 3) {
    return {
      shape: "indeterminate",
      managementRatio: managers.length === 0 ? 0 : ics.length / managers.length,
      managerCost,
      managerCostShare: totalCost === 0 ? 0 : managerCost / totalCost,
      byLayer,
    };
  }

  // Split the layers (excluding the single top-of-house layer) into an upper
  // and lower half by depth, and compare headcount concentration — a pyramid
  // narrows monotonically, a diamond or hourglass does not.
  const body = byLayer.slice(1);
  const mid = Math.floor(body.length / 2);
  const upperHalf = body.slice(0, mid);
  const lowerHalf = body.slice(mid);
  const upperHeadcount = upperHalf.reduce((s, l) => s + l.headcount, 0);
  const lowerHeadcount = lowerHalf.reduce((s, l) => s + l.headcount, 0);

  const middleLayers = body.slice(Math.max(0, mid - 1), mid + 1);
  const middleHeadcount = middleLayers.reduce((s, l) => s + l.headcount, 0);
  const edgeLayers = [body[0], body[body.length - 1]].filter(Boolean);
  const edgeHeadcount = edgeLayers.reduce((s, l) => s + l.headcount, 0);

  let shape: ShapeProfile["shape"];
  if (middleHeadcount > 0 && middleHeadcount >= edgeHeadcount * 1.25 && middleLayers.length < body.length) {
    shape = "diamond";
  } else if (edgeHeadcount > 0 && edgeHeadcount >= middleHeadcount * 1.25 && middleLayers.length < body.length) {
    shape = "hourglass";
  } else if (upperHeadcount <= lowerHeadcount) {
    shape = "pyramid";
  } else {
    shape = "diamond";
  }

  return {
    shape,
    managementRatio: managers.length === 0 ? 0 : ics.length / managers.length,
    managerCost,
    managerCostShare: totalCost === 0 ? 0 : managerCost / totalCost,
    byLayer,
  };
}
