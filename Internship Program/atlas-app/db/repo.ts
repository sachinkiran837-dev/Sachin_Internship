import { randomUUID } from "node:crypto";
import { eq, inArray, lt } from "drizzle-orm";
import { db } from "./client";
import { auditLog, ingestIssues, orgs, positions, scenarios, sourceFiles, uploadChunks } from "./schema";
import type { IngestIssue, Position, Move, AuditEntry } from "@/lib/graph/types";
import type { FileBinding } from "@/lib/ingest/bindFiles";
import type { IngestPlan } from "@/lib/ingest/plan";

/**
 * Rows per INSERT statement. The neon-http driver makes one HTTP round trip
 * per query, so inserting an establishment a row at a time costs one round
 * trip per position — at a few thousand positions that is not slow, it is a
 * request that never returns, and the upload appears to hang. Batching turns
 * a real client-sized establishment into a handful of round trips.
 *
 * 500 keeps each statement comfortably inside Postgres's 65535-parameter
 * ceiling (the widest table here is 14 columns) without building a statement
 * so large it becomes its own problem.
 */
const INSERT_BATCH = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

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
    synthetic: row.synthetic,
  };
}

export async function createOrg(input: {
  name: string;
  sourceFilename: string;
  anonymized: boolean;
  /** What the user typed on the upload screen, and how it was read. */
  ingestContext?: string | null;
  plan?: IngestPlan | null;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(orgs).values({
    id,
    name: input.name,
    sourceFilename: input.sourceFilename,
    anonymized: input.anonymized,
    createdAt: new Date().toISOString(),
    ingestContext: input.ingestContext?.trim() || null,
    planJson: input.plan ? JSON.stringify(input.plan) : null,
  });
  return id;
}

/** The plan an establishment was ingested under, if it was given instructions. */
export async function getIngestPlan(orgId: string): Promise<IngestPlan | null> {
  const rows = await db.select().from(orgs).where(eq(orgs.id, orgId));
  const raw = rows[0]?.planJson;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as IngestPlan;
  } catch {
    return null;
  }
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
    synthetic: p.synthetic,
  }));
  for (const batch of chunk(insertRows, INSERT_BATCH)) {
    await db.insert(positions).values(batch);
  }
}

export async function saveSourceFiles(orgId: string, bindings: FileBinding[]): Promise<void> {
  if (bindings.length === 0) return;

  await db.insert(sourceFiles).values(
    bindings.map((b, i) => ({
      id: randomUUID(),
      orgId,
      filename: b.filename,
      role: b.role,
      sourceFormat: b.sourceFormat,
      rowCount: b.rowCount,
      columnCount: b.columns.length,
      joinKey: b.joinKey,
      matchedRows: b.matchedRows,
      unmatchedRows: b.unmatchedRows,
      conflicts: b.conflicts,
      contributedFieldsJson: JSON.stringify(b.contributedFields),
      columnsJson: JSON.stringify(b.columns),
      conversionDetail: b.conversionDetail,
      detail: b.detail,
      needsReview: b.needsReview,
      planReason: b.planReason,
      orderIndex: i,
    }))
  );
}

export async function getSourceFiles(orgId: string): Promise<FileBinding[]> {
  const rows = await db.select().from(sourceFiles).where(eq(sourceFiles.orgId, orgId));

  return rows
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((r) => ({
      filename: r.filename,
      role: r.role as FileBinding["role"],
      rowCount: r.rowCount,
      joinKey: r.joinKey,
      matchedRows: r.matchedRows,
      unmatchedRows: r.unmatchedRows,
      contributedFields: JSON.parse(r.contributedFieldsJson) as string[],
      conflicts: r.conflicts,
      detail: r.detail,
      sourceFormat: r.sourceFormat,
      conversionDetail: r.conversionDetail,
      columns: JSON.parse(r.columnsJson) as FileBinding["columns"],
      needsReview: r.needsReview,
      planReason: r.planReason,
    }));
}

/**
 * Stores one piece of a file that is being uploaded across several requests.
 * Chunks are held only until the ingest that consumes them runs.
 */
export async function saveUploadChunk(input: {
  uploadId: string;
  filename: string;
  chunkIndex: number;
  chunkCount: number;
  data: string;
}): Promise<void> {
  await db.insert(uploadChunks).values({
    id: randomUUID(),
    ...input,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Reassembles a staged upload. Returns null when the pieces are incomplete
 * rather than handing back a truncated file — half a spreadsheet parses into
 * a plausible-looking establishment that is missing people.
 */
export async function loadUpload(
  uploadId: string
): Promise<{ filename: string; buffer: Buffer } | null> {
  const rows = await db
    .select()
    .from(uploadChunks)
    .where(eq(uploadChunks.uploadId, uploadId));

  if (rows.length === 0) return null;

  const expected = rows[0].chunkCount;
  const seen = new Set(rows.map((r) => r.chunkIndex));
  if (seen.size !== expected) return null;

  const ordered = [...rows].sort((a, b) => a.chunkIndex - b.chunkIndex);
  return {
    filename: ordered[0].filename,
    buffer: Buffer.concat(ordered.map((r) => Buffer.from(r.data, "base64"))),
  };
}

export async function deleteUploads(uploadIds: string[]): Promise<void> {
  if (uploadIds.length === 0) return;
  await db.delete(uploadChunks).where(inArray(uploadChunks.uploadId, uploadIds));
}

/**
 * Clears staged chunks left behind by an upload that was abandoned before it
 * was ingested — a closed tab, a lost connection. Runs on each new upload so
 * the table can't grow without bound; an hour is far longer than the seconds
 * a live upload needs.
 */
export async function purgeStaleUploads(): Promise<void> {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await db.delete(uploadChunks).where(lt(uploadChunks.createdAt, cutoff));
}

export async function saveIssues(issues: IngestIssue[]): Promise<void> {
  if (issues.length === 0) return;
  for (const batch of chunk(issues, INSERT_BATCH)) {
    await db.insert(ingestIssues).values(batch);
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
