import { pgTable, text, integer, real, boolean } from "drizzle-orm/pg-core";

export const orgs = pgTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  anonymized: boolean("anonymized").notNull().default(true),
  sourceFilename: text("source_filename").notNull(),
  createdAt: text("created_at").notNull(),
});

export const positions = pgTable("positions", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  rawName: text("raw_name"),
  displayName: text("display_name").notNull(),
  title: text("title").notNull(),
  department: text("department").notNull(),
  managerId: text("manager_id"),
  cost: real("cost").notNull(),
  fte: real("fte").notNull().default(1),
  status: text("status").notNull().default("filled"),
  clinicalFlag: boolean("clinical_flag").notNull().default(false),
  sourceRowIndex: integer("source_row_index").notNull(),
  confidenceJson: text("confidence_json").notNull().default("{}"),
  classificationSource: text("classification_source").notNull().default("fallback"),
});

export const ingestIssues = pgTable("ingest_issues", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  kind: text("kind").notNull(),
  positionId: text("position_id"),
  detail: text("detail").notNull(),
  resolved: boolean("resolved").notNull().default(false),
});

export const scenarios = pgTable("scenarios", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  workingGraphJson: text("working_graph_json").notNull(),
  movesJson: text("moves_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});

export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey(),
  scenarioId: text("scenario_id").notNull(),
  positionId: text("position_id"),
  action: text("action").notNull(),
  detail: text("detail").notNull(),
  who: text("who").notNull(),
  when: text("when").notNull(),
});

export type OrgRow = typeof orgs.$inferSelect;
export type PositionRow = typeof positions.$inferSelect;
export type ScenarioRow = typeof scenarios.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type IngestIssueRow = typeof ingestIssues.$inferSelect;
