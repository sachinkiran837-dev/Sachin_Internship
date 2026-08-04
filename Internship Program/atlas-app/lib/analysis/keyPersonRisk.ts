import riskConfig from "@/config/key-person-risk.json";
import { tagNodes } from "@/lib/graph/tagging";
import { daysSince } from "@/lib/ingest/parseDate";
import type { LayoutNode, Position } from "@/lib/graph/types";

/**
 * e2-key-person-risk: the single points of failure a redesign could snap,
 * triaged as a caution a scenario can knowingly override — never confused
 * with E1's absolute hold, even when the same role carries both.
 *
 * "Control position" is proxied as protected-or-manager: this build has no
 * separate B-module control-point register beyond E1's own, so a manager or
 * an E1-held role is what "control position" means here.
 */

const TENURE_CLIFF_YEARS = riskConfig.tenureCliffYears;

export type KeyPersonReason = "sole-incumbent" | "unique-classification" | "tenure-cliff";
export type Triage = "protect" | "succession-plan" | "redesign-carefully";

export interface KeyPersonFlag {
  id: string;
  title: string;
  functionGroup: string;
  reasons: KeyPersonReason[];
  tenureYears: number | null;
  triage: Triage;
  isE1Protected: boolean;
}

export interface KeyPersonRiskResult {
  flagged: KeyPersonFlag[];
  soleIncumbentCount: number;
  uniqueClassificationCount: number;
  tenureCliffCount: number;
  tenureCliffThresholdYears: number;
}

function triageFor(isE1Protected: boolean, reasons: KeyPersonReason[]): Triage {
  if (isE1Protected) return "protect";
  if (reasons.includes("sole-incumbent") || reasons.includes("unique-classification")) return "succession-plan";
  return "redesign-carefully";
}

export function buildKeyPersonRisk(positions: Position[], rootId: string | null): KeyPersonRiskResult {
  const tagged = tagNodes(positions, rootId).filter((n) => !n.synthetic);
  // A vacant position has no incumbent to lose and no one holding a
  // classification — it can't itself be a single point of failure, though a
  // filled peer elsewhere with the same title or grade still can be.
  const incumbents = tagged.filter((n) => n.status !== "vacant");

  const titleCounts = new Map<string, number>();
  const gradeCounts = new Map<string, number>();
  for (const n of incumbents) {
    titleCounts.set(n.title, (titleCounts.get(n.title) ?? 0) + 1);
    if (n.grade) gradeCounts.set(n.grade, (gradeCounts.get(n.grade) ?? 0) + 1);
  }

  const isControlPosition = (n: LayoutNode) => Boolean(n.flags.protected) || n.childIds.length > 0;

  const flagged: KeyPersonFlag[] = [];
  for (const n of incumbents) {
    const reasons: KeyPersonReason[] = [];
    const tenureYears = daysSince(n.startDate) !== null ? daysSince(n.startDate)! / 365.25 : null;

    if (isControlPosition(n) && titleCounts.get(n.title) === 1) reasons.push("sole-incumbent");
    if (n.grade && gradeCounts.get(n.grade) === 1) reasons.push("unique-classification");
    if (isControlPosition(n) && tenureYears !== null && tenureYears >= TENURE_CLIFF_YEARS) reasons.push("tenure-cliff");

    if (reasons.length === 0) continue;

    flagged.push({
      id: n.id,
      title: n.title,
      functionGroup: n.functionGroup,
      reasons,
      tenureYears,
      triage: triageFor(Boolean(n.flags.protected), reasons),
      isE1Protected: Boolean(n.flags.protected),
    });
  }

  return {
    flagged: flagged.sort((a, b) => b.reasons.length - a.reasons.length),
    soleIncumbentCount: flagged.filter((f) => f.reasons.includes("sole-incumbent")).length,
    uniqueClassificationCount: flagged.filter((f) => f.reasons.includes("unique-classification")).length,
    tenureCliffCount: flagged.filter((f) => f.reasons.includes("tenure-cliff")).length,
    tenureCliffThresholdYears: TENURE_CLIFF_YEARS,
  };
}

/** H2's "key-person roles touched" count: how many flagged roles a change set's positions overlap. */
export function keyPersonRolesTouched(flagged: KeyPersonFlag[], touchedPositionIds: Set<string>): number {
  return flagged.filter((f) => touchedPositionIds.has(f.id)).length;
}

export const KEY_PERSON_METHOD =
  `A key-person flag is a caution, not a hold — a scenario can proceed against one deliberately, unlike an E1 hold, ` +
  `which never yields. Where both apply to the same role, the flag stays visible but the triage reads "protect", ` +
  `naming the E1 hold as the reason rather than letting the two signals blur together.`;
