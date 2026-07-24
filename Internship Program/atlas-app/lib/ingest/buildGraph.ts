import { randomUUID } from "node:crypto";
import type { ParsedFile } from "./parseFile";
import { mapColumns } from "./columnMapper";
import { pseudonymize } from "./anonymize";
import { classifyRole } from "./classify";
import type {
  ColumnMapping,
  FieldConfidence,
  IngestIssue,
  Position,
  PositionStatus,
} from "@/lib/graph/types";

export interface BuildGraphOptions {
  orgId: string;
  anonymize: boolean;
}

export interface BuildGraphResult {
  positions: Position[];
  issues: IngestIssue[];
  columnMapping: ColumnMapping[];
}

function fieldConfidence(mapping: ColumnMapping[], field: string): number {
  const m = mapping.find((c) => c.targetField === field);
  return m ? m.confidence : 0;
}

function sourceColumnFor(mapping: ColumnMapping[], field: string): string | null {
  return mapping.find((c) => c.targetField === field)?.sourceColumn ?? null;
}

function parseCost(raw: string): number {
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseFte(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parseStatus(raw: string): PositionStatus {
  const t = raw.toLowerCase();
  if (t.includes("vacant")) return "vacant";
  if (t.includes("contingent") || t.includes("contract") || t.includes("temp")) {
    return "contingent";
  }
  return "filled";
}

const CHIEF_EXECUTIVE_KEYWORDS = ["chief executive", "ceo", "managing director"];

function looksLikeManagement(title: string): boolean {
  const t = title.toLowerCase();
  return ["chief", "director", "head of", "manager", "vp", "lead", "president"].some((k) =>
    t.includes(k)
  );
}

interface RawRow {
  sourceRowIndex: number;
  positionIdRaw: string;
  rawName: string;
  title: string;
  department: string;
  managerNameRaw: string;
  cost: number;
  fte: number;
  status: PositionStatus;
}

export async function buildOrgGraph(
  file: ParsedFile,
  options: BuildGraphOptions
): Promise<BuildGraphResult> {
  const columnMapping = mapColumns(file.headers);
  const issues: IngestIssue[] = [];

  const nameCol = sourceColumnFor(columnMapping, "name");
  const titleCol = sourceColumnFor(columnMapping, "title");
  const deptCol = sourceColumnFor(columnMapping, "department");
  const managerCol = sourceColumnFor(columnMapping, "managerName");
  const idCol = sourceColumnFor(columnMapping, "positionId");
  const costCol = sourceColumnFor(columnMapping, "cost");
  const fteCol = sourceColumnFor(columnMapping, "fte");
  const statusCol = sourceColumnFor(columnMapping, "status");

  for (const [field, col] of Object.entries({
    name: nameCol,
    title: titleCol,
    department: deptCol,
  })) {
    if (!col) {
      issues.push({
        id: randomUUID(),
        orgId: options.orgId,
        kind: "unmapped_column",
        positionId: null,
        detail: `No column could be mapped to "${field}" — every row will need this confirmed manually.`,
        resolved: false,
      });
    }
  }

  // Pass 1: raw rows, de-duplicating on position ID (keep first occurrence).
  const seenIds = new Set<string>();
  const rawRows: RawRow[] = [];

  file.rows.forEach((row, index) => {
    const positionIdRaw = (idCol ? row[idCol] : "").trim() || `row-${index}`;

    if (seenIds.has(positionIdRaw)) {
      issues.push({
        id: randomUUID(),
        orgId: options.orgId,
        kind: "duplicate",
        positionId: null,
        detail: `Row ${index + 2}: duplicate position ID "${positionIdRaw}" — kept the first occurrence, this row was dropped.`,
        resolved: false,
      });
      return;
    }
    seenIds.add(positionIdRaw);

    rawRows.push({
      sourceRowIndex: index,
      positionIdRaw,
      rawName: (nameCol ? row[nameCol] : "").trim() || `Unnamed row ${index + 2}`,
      title: (titleCol ? row[titleCol] : "").trim() || "Unspecified title",
      department: (deptCol ? row[deptCol] : "").trim() || "Unclassified",
      managerNameRaw: (managerCol ? row[managerCol] : "").trim(),
      cost: costCol ? parseCost(row[costCol]) : 0,
      fte: fteCol ? parseFte(row[fteCol]) : 1,
      status: statusCol ? parseStatus(row[statusCol]) : "filled",
    });
  });

  // Pass 2: assign internal ids, index by raw id and by name for manager
  // resolution (exports reference managers by either).
  const internalId = new Map<string, string>(); // positionIdRaw -> internal id
  const byName = new Map<string, string>(); // normalized raw name -> internal id

  for (const row of rawRows) {
    const id = randomUUID();
    internalId.set(row.positionIdRaw, id);
    byName.set(row.rawName.trim().toLowerCase(), id);
  }

  // Pass 3: resolve manager references.
  interface Resolved {
    row: RawRow;
    id: string;
    managerId: string | null;
    managerConfidence: number;
    orphan: boolean;
  }

  const resolved: Resolved[] = rawRows.map((row) => {
    const id = internalId.get(row.positionIdRaw)!;

    if (!row.managerNameRaw) {
      return { row, id, managerId: null, managerConfidence: 1, orphan: false };
    }

    const byId = internalId.get(row.managerNameRaw);
    if (byId && byId !== id) {
      return { row, id, managerId: byId, managerConfidence: 1, orphan: false };
    }

    const byNameMatch = byName.get(row.managerNameRaw.trim().toLowerCase());
    if (byNameMatch && byNameMatch !== id) {
      return { row, id, managerId: byNameMatch, managerConfidence: 0.7, orphan: false };
    }

    // Manager reference didn't resolve to anything in this file.
    return { row, id, managerId: null, managerConfidence: 0.3, orphan: true };
  });

  // Pick the root: prefer a title match on chief-executive keywords among
  // the no-manager rows; otherwise the first no-manager row. Every other
  // no-manager row is an unresolved orphan needing attachment, but the
  // chosen root is never counted as one.
  const noManagerRows = resolved.filter((r) => r.managerId === null && !r.orphan);
  const rootEntry =
    noManagerRows.find((r) =>
      CHIEF_EXECUTIVE_KEYWORDS.some((k) => r.row.title.toLowerCase().includes(k))
    ) ?? noManagerRows[0];

  if (rootEntry) {
    for (const r of noManagerRows) {
      if (r.id !== rootEntry.id) r.orphan = true;
    }
  }

  // Attach orphans: prefer another already-anchored, management-looking
  // position in the same department; otherwise lift to root.
  const anchored = resolved.filter((r) => !r.orphan && r.managerId !== null);

  for (const r of resolved) {
    if (!r.orphan) continue;

    const deptManager = anchored.find(
      (a) => a.row.department === r.row.department && looksLikeManagement(a.row.title)
    );

    if (deptManager) {
      r.managerId = deptManager.id;
      r.managerConfidence = 0.4;
    } else if (rootEntry && r.id !== rootEntry.id) {
      r.managerId = rootEntry.id;
      r.managerConfidence = 0.3;
    } else {
      r.managerId = null;
      r.managerConfidence = 1;
    }

    issues.push({
      id: randomUUID(),
      orgId: options.orgId,
      kind: "orphan",
      positionId: r.id,
      detail: `"${r.row.title}" (${r.row.rawName}) had no resolvable manager — ${
        deptManager ? `attached to ${deptManager.row.title} by department` : "lifted to the top"
      }. Confirm on the next screen.`,
      resolved: false,
    });
  }

  // Break any cycles a bad export could introduce (defensive: a fresh
  // ingest shouldn't have them, but a corrected re-export might).
  const managerOf = new Map(resolved.map((r) => [r.id, r] as const));
  for (const r of resolved) {
    const visited = new Set<string>();
    let cursor: Resolved | undefined = r;
    while (cursor?.managerId) {
      if (visited.has(cursor.id)) {
        r.managerId = rootEntry ? rootEntry.id : null;
        issues.push({
          id: randomUUID(),
          orgId: options.orgId,
          kind: "orphan",
          positionId: r.id,
          detail: `"${r.row.title}" was part of a reporting-line cycle in the source file — lifted to the top. Confirm on the next screen.`,
          resolved: false,
        });
        break;
      }
      visited.add(cursor.id);
      cursor = cursor.managerId ? managerOf.get(cursor.managerId) : undefined;
    }
  }

  // Pass 4: classify + assemble positions.
  const nameConfidence = fieldConfidence(columnMapping, "name");
  const titleConfidence = fieldConfidence(columnMapping, "title");
  const deptConfidence = fieldConfidence(columnMapping, "department");

  const positions: Position[] = await Promise.all(
    resolved.map(async (r) => {
      const classification = await classifyRole(r.row.title, r.row.department);

      const confidence: FieldConfidence = {
        name: nameConfidence,
        title: titleConfidence,
        department: deptConfidence,
        manager: r.managerConfidence,
        classification: classification.confidence,
      };

      if (r.managerConfidence < 0.6 || classification.confidence < 0.6) {
        issues.push({
          id: randomUUID(),
          orgId: options.orgId,
          kind: "low_confidence",
          positionId: r.id,
          detail: `Low-confidence inference on "${r.row.title}" — review before treating this record as confirmed.`,
          resolved: false,
        });
      }

      return {
        id: r.id,
        orgId: options.orgId,
        rawName: options.anonymize ? null : r.row.rawName,
        displayName: options.anonymize
          ? pseudonymize(r.row.rawName, r.row.sourceRowIndex)
          : r.row.rawName,
        title: r.row.title,
        department: r.row.department,
        managerId: r.managerId,
        cost: r.row.cost,
        fte: r.row.fte,
        status: r.row.status,
        clinicalFlag: classification.clinicalFlag,
        sourceRowIndex: r.row.sourceRowIndex,
        confidence,
        classificationSource: classification.source,
      } satisfies Position;
    })
  );

  return { positions, issues, columnMapping };
}
