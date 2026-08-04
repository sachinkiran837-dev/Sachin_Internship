import seniorityConfig from "@/config/seniority-keywords.json";
import mixConfig from "@/config/workforce-mix.json";
import { tagNodes } from "@/lib/graph/tagging";
import { daysSince } from "@/lib/ingest/parseDate";
import type { LayoutNode, Position } from "@/lib/graph/types";

/**
 * d3-workforce-mix-classification: whether grade and skill mix match the
 * work, read at department level (D3's "unit") and compared against the
 * peer departments inside the same function-group bucket — never against
 * the whole organisation, which would misread a genuinely specialist team as
 * drift just for being what it is.
 *
 * Skill-mix ratios (RN-to-total-nursing and its equivalents) need a
 * sector-specific classification taxonomy no generic establishment file
 * carries, so this always reads "not computable" here rather than guessing
 * one from title keywords — the same discipline C4 applies to activity data.
 */

const SENIOR_GRADE_KEYWORDS = seniorityConfig.matchGrades;
const SMALL_FRACTION_THRESHOLD = mixConfig.smallFractionThreshold;
const MIN_HEADCOUNT_FOR_SENIOR_SHARE = mixConfig.minUnitHeadcountForSeniorShare;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function isSeniorGrade(grade: string): boolean {
  const g = grade.toLowerCase();
  return SENIOR_GRADE_KEYWORDS.some((kw) => g.includes(kw));
}

export interface GradeCount {
  grade: string;
  count: number;
}

export interface UnitWorkforceMix {
  department: string;
  functionGroup: string;
  headcount: number;
  gradeDistribution: GradeCount[];
  gradedCount: number;
  /** Null when too few graded positions in this unit for the share to mean anything. */
  seniorShare: number | null;
  /** Median senior share across other departments in the same function group. Null when there's no comparator. */
  peerMedianSeniorShare: number | null;
  fragmentationCount: number;
  medianTenureYears: number | null;
}

export interface WorkforceMixResult {
  byUnit: UnitWorkforceMix[];
  gradeCoverage: number;
  tenureCoverage: number;
  skillMixRatio: null;
  skillMixNote: string;
}

function computeUnit(department: string, functionGroup: string, members: LayoutNode[]): UnitWorkforceMix {
  const graded = members.filter((n) => n.grade !== null && n.grade.trim() !== "");
  const gradeCounts = new Map<string, number>();
  for (const n of graded) {
    const g = n.grade!.trim();
    gradeCounts.set(g, (gradeCounts.get(g) ?? 0) + 1);
  }

  const seniorCount = graded.filter((n) => isSeniorGrade(n.grade!)).length;
  const seniorShare = graded.length >= MIN_HEADCOUNT_FOR_SENIOR_SHARE ? seniorCount / graded.length : null;

  const tenures = members
    .map((n) => daysSince(n.startDate))
    .filter((d): d is number => d !== null)
    .map((d) => d / 365.25);

  return {
    department,
    functionGroup,
    headcount: members.length,
    gradeDistribution: [...gradeCounts.entries()]
      .map(([grade, count]) => ({ grade, count }))
      .sort((a, b) => b.count - a.count),
    gradedCount: graded.length,
    seniorShare,
    peerMedianSeniorShare: null, // filled in once every unit's own share is known
    fragmentationCount: members.filter((n) => n.fte > 0 && n.fte < SMALL_FRACTION_THRESHOLD).length,
    medianTenureYears: median(tenures),
  };
}

export function buildWorkforceMix(positions: Position[], rootId: string | null): WorkforceMixResult {
  const tagged = tagNodes(positions, rootId).filter((n) => !n.synthetic);

  const byDepartment = new Map<string, LayoutNode[]>();
  for (const n of tagged) {
    byDepartment.set(n.department, [...(byDepartment.get(n.department) ?? []), n]);
  }

  const units = [...byDepartment.entries()].map(([dept, members]) =>
    computeUnit(dept, members[0].functionGroup, members)
  );

  // Peer comparator: the median senior share among the *other* departments
  // sharing this one's function group — same-function, never org-wide, per
  // the skill's own edge case about misfiring on genuinely specialist units.
  const byFunction = new Map<string, UnitWorkforceMix[]>();
  for (const u of units) {
    byFunction.set(u.functionGroup, [...(byFunction.get(u.functionGroup) ?? []), u]);
  }

  for (const u of units) {
    const peers = (byFunction.get(u.functionGroup) ?? []).filter(
      (p) => p.department !== u.department && p.seniorShare !== null
    );
    u.peerMedianSeniorShare = median(peers.map((p) => p.seniorShare!));
  }

  const graded = tagged.filter((n) => n.grade !== null && n.grade.trim() !== "").length;
  const tenured = tagged.filter((n) => n.startDate !== null).length;

  return {
    byUnit: units.sort((a, b) => b.headcount - a.headcount),
    gradeCoverage: tagged.length === 0 ? 0 : graded / tagged.length,
    tenureCoverage: tagged.length === 0 ? 0 : tenured / tagged.length,
    skillMixRatio: null,
    skillMixNote:
      "Skill-mix ratios (e.g. a senior-to-total ratio within one discipline) need a sector-specific classification " +
      "taxonomy no generic establishment file carries — never guessed from title keywords, so this always reads " +
      "\"not computable\" in this build.",
  };
}

export const WORKFORCE_MIX_METHOD =
  `Senior-grade share is read against the median of peer departments in the same function group, never against the ` +
  `whole organisation — a genuinely specialist unit is not drift just for being senior-heavy. A department needs at ` +
  `least ${MIN_HEADCOUNT_FOR_SENIOR_SHARE} graded positions before its senior share is shown at all.`;
