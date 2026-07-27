export type PositionStatus = "filled" | "vacant" | "contingent";

export type FieldConfidence = Record<string, number>;

export interface Position {
  id: string;
  orgId: string;
  rawName: string | null;
  displayName: string;
  title: string;
  department: string;
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

export const CANONICAL_FIELDS = {
  name: "Employee name",
  title: "Position title",
  department: "Department / function",
  managerName: "Manager (name or ID)",
  positionId: "Position ID",
  cost: "Fully-loaded cost",
  fte: "FTE",
  status: "Status (filled / vacant / contingent)",
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
}

export interface NodeFlags {
  protected: ProtectedMatch | null;
  unitRoster: boolean;
  singleReport: boolean;
  spanHealth: "thin" | "healthy" | "wide";
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

export interface DiagnosticMetrics {
  headcount: number;
  filledCount: number;
  vacantCount: number;
  contingentCount: number;
  totalCost: number;
  layers: number;
  averageSpan: number;
  thinSpanCount: number;
  wideSpanCount: number;
  singleReportCount: number;
  protectedCount: number;
  protectedByTier: Record<ProtectedTier, number>;
  flaggedPatterns: FlaggedPattern[];
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
}
