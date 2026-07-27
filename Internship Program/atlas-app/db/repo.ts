import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { auditLog, ingestIssues, orgs, positions, scenarios } from "./schema";
import type { IngestIssue, Position, Move, AuditEntry } from "@/lib/graph/types";

function toPosition(row: typeof positions.$inferSelect): Position {
  return {
    id: row.id,
    orgId: row.orgId,
    rawName: row.rawName,
    displayName: row.displayName,
    title: row.title,
    department: row.department,
    managerId: row.managerId,
    cost: row.cost,
    fte: row.fte,
    status: row.status as Position["status"],
    clinicalFlag: row.clinicalFlag,
    sourceRowIndex: row.sourceRowIndex,
    confidence: JSON.parse(row.confidenceJson),
    classificationSource: row.classificationSource as Position["classificationSource"],
  };
}

export async function createOrg(input: {
  name: string;
  sourceFilename: string;
  anonymized: boolean;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(orgs).values({
    id,
    name: input.name,
    sourceFilename: input.sourceFilename,
    anonymized: input.anonymized,
    createdAt: new Date().toISOString(),
  });
  return id;
}

export async function savePositions(rows: Position[]): Promise<void> {
  if (rows.length === 0) return;
  const insertRows = rows.map((p) => ({
    id: p.id,
    orgId: p.orgId,
    rawName: p.rawName,
    displayName: p.displayName,
    title: p.title,
    department: p.department,
    managerId: p.managerId,
    cost: p.cost,
    fte: p.fte,
    status: p.status,
    clinicalFlag: p.clinicalFlag,
    sourceRowIndex: p.sourceRowIndex,
    confidenceJson: JSON.stringify(p.confidence),
    classificationSource: p.classificationSource,
  }));
  for (const row of insertRows) {
    await db.insert(positions).values(row);
  }
}

export async function saveIssues(issues: IngestIssue[]): Promise<void> {
  for (const issue of issues) {
    await db.insert(ingestIssues).values(issue);
  }
}

export async function getOrg(orgId: string) {
  const rows = await db.select().from(orgs).where(eq(orgs.id, orgId));
  return rows[0];
}

export async function listOrgs() {
  return db.select().from(orgs);
}

export async function getBaselinePositions(orgId: string): Promise<Position[]> {
  const rows = await db.select().from(positions).where(eq(positions.orgId, orgId));
  return rows.map(toPosition);
}

export function getBaselineRootId(baseline: Position[]): string | null {
  return baseline.find((p) => p.managerId === null)?.id ?? null;
}

export async function getIssues(orgId: string): Promise<IngestIssue[]> {
  const rows = await db.select().from(ingestIssues).where(eq(ingestIssues.orgId, orgId));
  return rows as IngestIssue[];
}

export interface ScenarioRecord {
  id: string;
  orgId: string;
  name: string;
  status: string;
  positions: Position[];
  moves: Move[];
  createdAt: string;
}

function toScenario(row: typeof scenarios.$inferSelect): ScenarioRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    status: row.status,
    positions: JSON.parse(row.workingGraphJson),
    moves: JSON.parse(row.movesJson),
    createdAt: row.createdAt,
  };
}

export async function listScenarios(orgId: string): Promise<ScenarioRecord[]> {
  const rows = await db.select().from(scenarios).where(eq(scenarios.orgId, orgId));
  return rows.map(toScenario);
}

export async function getScenario(scenarioId: string): Promise<ScenarioRecord | null> {
  const rows = await db.select().from(scenarios).where(eq(scenarios.id, scenarioId));
  return rows[0] ? toScenario(rows[0]) : null;
}

export async function getActiveScenario(orgId: string): Promise<ScenarioRecord | null> {
  const rows = await db.select().from(scenarios).where(eq(scenarios.orgId, orgId));
  const active = rows.find((r) => r.status === "active");
  return active ? toScenario(active) : null;
}

/**
 * Auto-create-or-append working-copy contract: the first edit on a fresh
 * baseline creates the scenario; every edit after that appends to it.
 */
export async function getOrCreateActiveScenario(orgId: string): Promise<ScenarioRecord> {
  const existing = await getActiveScenario(orgId);
  if (existing) return existing;

  const baseline = await getBaselinePositions(orgId);
  const id = randomUUID();
  const scenarioRow = {
    id,
    orgId,
    name: "Working scenario",
    status: "active",
    workingGraphJson: JSON.stringify(baseline),
    movesJson: "[]",
    createdAt: new Date().toISOString(),
  };
  await db.insert(scenarios).values(scenarioRow);
  return toScenario(scenarioRow as typeof scenarios.$inferSelect);
}

export async function createNamedScenario(orgId: string, name: string): Promise<ScenarioRecord> {
  const baseline = await getBaselinePositions(orgId);
  const id = randomUUID();
  const scenarioRow = {
    id,
    orgId,
    name,
    status: "draft",
    workingGraphJson: JSON.stringify(baseline),
    movesJson: "[]",
    createdAt: new Date().toISOString(),
  };
  await db.insert(scenarios).values(scenarioRow);
  return toScenario(scenarioRow as typeof scenarios.$inferSelect);
}

export async function saveScenarioState(
  scenarioId: string,
  nextPositions: Position[],
  moves: Move[]
): Promise<void> {
  await db
    .update(scenarios)
    .set({ workingGraphJson: JSON.stringify(nextPositions), movesJson: JSON.stringify(moves) })
    .where(eq(scenarios.id, scenarioId));
}

export async function appendAuditEntry(entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values(entry);
}

export async function listAuditLog(scenarioId: string): Promise<AuditEntry[]> {
  const rows = await db.select().from(auditLog).where(eq(auditLog.scenarioId, scenarioId));
  return rows as AuditEntry[];
}
