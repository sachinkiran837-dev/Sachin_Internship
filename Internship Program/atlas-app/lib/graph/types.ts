export type PositionStatus = "filled" | "vacant" | "contingent";

export type FieldConfidence = Record<string, number>;

export interface Position {
  id: string;
  orgId: string;
  rawName: string | null;
  displayName: string;
  title: string;
  department: string;
  /**
   * The function this department rolls up into. Falls back to the department
   * itself where nothing would place it, so this is always safe to group by.
   */
  functionGroup: string;
  /** C1: the physical site/location a position sits at. Null where no file supplied one. */
  site: string | null;
  /** D3/E3: classification/grade/pay-band, kept apart from the ingest role classifier's own "classification". Null where no file supplied one. */
  grade: string | null;
  /** D3/E2: ISO-ish date string this incumbent started. Null where no file supplied one or the value couldn't be parsed as a date. */
  startDate: string | null;
  /** D2: ISO-ish date string this position became vacant. Null unless status is vacant and a file supplied one. */
  vacantSince: string | null;
  managerId: string | null;
  cost: number;
  fte: number;
  status: PositionStatus;
  clinicalFlag: boolean;
  sourceRowIndex: number;
  confidence: FieldConfidence;
  classificationSource: "ai" | "fallback";
  /**
   * A node Atlas added to hold the structure together — a brand or entity
   * heading when an establishment is consolidated across several of them.
   * It is not a job and nobody is in it, so it is drawn on the map and
   * excluded from every count and every cost. Anything that sums positions
   * must skip these or the headcount is a lie.
   */
  synthetic: boolean;
}

export type IssueKind =
  | "orphan"
  | "duplicate"
  | "low_confidence"
  | "unmapped_column"
  | "conversion";

export interface IngestIssue {
  id: string;
  orgId: string;
  kind: IssueKind;
  positionId: string | null;
  detail: string;
  resolved: boolean;
}

export interface ColumnMapping {
  sourceColumn: string;
  targetField: keyof typeof CANONICAL_FIELDS | null;
  confidence: number;
  autoMapped: boolean;
}

/**
 * What a position's department reads as when no department column reached it.
 *
 * A sentinel rather than an empty string, because the map, the comparison
 * engine and the canonical table all have to agree on what "no department"
 * looks like — and three screens each testing for their own version of empty
 * is how one of them starts showing a department called "".
 */
export const UNCLASSIFIED = "Unclassified";

export const CANONICAL_FIELDS = {
  name: "Employee name",
  title: "Position title",
  department: "Department / function",
  managerName: "Manager (name or ID)",
  positionId: "Position ID",
  cost: "Fully-loaded cost",
  fte: "FTE",
  status: "Status (filled / vacant / contingent)",
  site: "Site / location",
  grade: "Classification / grade",
  startDate: "Start date",
  vacantSince: "Vacant since",
} as const;

export type ProtectedTier = "statutory" | "governance" | "safety";

export interface ProtectedRoleRule {
  id: string;
  match: string[];
  tier: ProtectedTier;
  instrument: string;
  reason: string;
}

export interface ProtectedMatch {
  tier: ProtectedTier;
  instrument: string;
  reason: string;
  ruleId: string;
}

export interface SpanThresholds {
  healthyMin: number;
  healthyMax: number;
  /** A0/B1: a manager with at least this many predominantly-clinical reports is staffing a roster, not running a management span. */
  unitRosterMin: number;
}

export interface NodeFlags {
  protected: ProtectedMatch | null;
  /** True when this manager is staffing a clinical/frontline roster (A2) — exempt from span-health flagging. */
  unitRoster: boolean;
  singleReport: boolean;
  spanHealth: "thin" | "healthy" | "wide";
  /** The B1 work-archetype this manager's span was benchmarked against — see span-archetype.ts. */
  spanArchetype: string;
  keyPerson: boolean;
  vacant: boolean;
  contingent: boolean;
}

export interface LayoutNode extends Position {
  x: number;
  y: number;
  depth: number;
  childIds: string[];
  flags: NodeFlags;
}

export interface OrgGraph {
  orgId: string;
  rootId: string | null;
  positions: Position[];
}

export type MoveKind =
  | "reassign"
  | "remove"
  | "add"
  | "merge"
  | "flatten"
  | "rebase"
  | "play"
  | "unrecognized";

export interface Move {
  id: string;
  kind: MoveKind;
  raw: string;
  description: string;
  targetPositionId?: string;
  newManagerId?: string;
  mergeIntoId?: string;
  layers?: number;
  blocked: boolean;
  blockReason?: string;
  appliedAt: string;
}

export interface AuditEntry {
  id: string;
  scenarioId: string;
  positionId: string | null;
  action: string;
  detail: string;
  who: string;
  when: string;
}

/** B1: span-health counts for one work archetype. */
export interface SpanArchetypeBreakdown {
  archetype: string;
  label: string;
  count: number;
  thinCount: number;
  healthyCount: number;
  wideCount: number;
}

/** B2: the org (or a unit) read against the absolute layer peer-band. */
export interface LayerBandVerdict {
  layers: number;
  healthyMin: number;
  healthyMax: number;
  flagAbove: number;
  verdict: "in-band" | "over-band" | "under-band";
}

/** B3: where single-report management chains concentrate. */
export interface SingleReportConcentration {
  functionGroup: string;
  count: number;
  cost: number;
}

/** B4: the headcount-by-layer silhouette and what it reads as. */
export interface ShapeProfile {
  shape: "pyramid" | "diamond" | "hourglass" | "indeterminate";
  managementRatio: number;
  /** Raw fully-weighted cost of every manager (childIds.length > 0) — F1 needs this to re-base the share against something other than total cost. */
  managerCost: number;
  managerCostShare: number;
  byLayer: { depth: number; headcount: number; managerShare: number }[];
}

/** B5: structural noise that erodes accountability before it reaches other metrics. */
export interface HygieneMetrics {
  orphanCount: number;
  coordinatorCount: number;
  supportRatio: number;
}

export interface DiagnosticMetrics {
  headcount: number;
  filledCount: number;
  vacantCount: number;
  contingentCount: number;
  /** Sum of contracted FTE. Diverges from headcount wherever agency staff sit at 0. */
  totalFte: number;
  /** C4: FTE carrying a clinical flag — the roster population activity-per-clinical-FTE would be computed over. */
  clinicalFte: number;
  /** F1: fully-weighted cost of every clinically-flagged position — the base a public-health organisation's overhead shares must be read against instead of total cost. */
  clinicalCost: number;
  totalCost: number;
  /** A3: totalCost with on-costs applied (super, leave loading, payroll tax, workers comp) — see lib/cost/onCosts.ts. */
  totalCostFullyLoaded: number;
  /** A3: positions with no recorded cost, and what a classification-median estimate would put them at where one is available. Never folded into totalCost — visible and flagged "est." instead. */
  unpricedCount: number;
  unpricedEstimatedCost: number;
  layers: number;
  averageSpan: number;
  thinSpanCount: number;
  wideSpanCount: number;
  singleReportCount: number;
  /** B3: fully-loaded cost of every single-report management role. */
  singleReportCost: number;
  singleReportByFunction: SingleReportConcentration[];
  protectedCount: number;
  protectedByTier: Record<ProtectedTier, number>;
  /** E1: held-role coverage by directorate (the tree-branch cut), so a gap is visible per part of the business, not just org-wide. */
  protectedByDirectorate: { directorate: string; count: number }[];
  /** E1: a rule in the configured register with zero matches anywhere in the graph — a control gap, not a null result. */
  controlGaps: ProtectedRoleRule[];
  flaggedPatterns: FlaggedPattern[];
  spanByArchetype: SpanArchetypeBreakdown[];
  layerBand: LayerBandVerdict;
  shape: ShapeProfile;
  hygiene: HygieneMetrics;
}

export interface FlaggedPattern {
  id: string;
  label: string;
  detail: string;
  positionIds: string[];
}

export interface Finding {
  id: string;
  headline: string;
  soWhat: string;
  evidenceIds: string[];
  followups: string[];
}

export interface FindingsResult {
  narrative: string;
  findings: Finding[];
  followups: string[];
  source: "ai" | "fallback";
}

export interface MetricsDelta {
  headcountDelta: number;
  costDelta: number;
  layersDelta: number;
  averageSpanDelta: number;
  safeStaffingBreach: boolean;
  breachedPositionIds: string[];
  /** E2: how many key-person-flagged roles this scenario's change set touches — attached by default, not on request. */
  keyPersonTouched: number;
}
