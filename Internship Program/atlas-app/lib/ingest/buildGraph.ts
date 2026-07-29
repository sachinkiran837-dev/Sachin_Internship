import { randomUUID } from "node:crypto";
import type { ParsedFile } from "./parseFile";
import { mapColumns } from "./columnMapper";
import { pseudonymize } from "./anonymize";
import { classifyRoles, roleKey, type RoleClassification } from "./classify";
import { note, type IngestNote } from "./notes";
import {
  UNCLASSIFIED,
  type ColumnMapping,
  type FieldConfidence,
  type IngestIssue,
  type Position,
  type PositionStatus,
} from "@/lib/graph/types";

export interface BuildGraphOptions {
  orgId: string;
  anonymize: boolean;
  /**
   * Consolidate the establishment on one column — brand, entity, region.
   * Each distinct value gets a heading node, and every role that would
   * otherwise float to the top of the map hangs under its own heading
   * instead of under whichever role happened to be picked as the root.
   */
  groupBy?: { column: string; label: string; topLabel: string } | null;
}

export interface BuildGraphResult {
  positions: Position[];
  issues: IngestIssue[];
  columnMapping: ColumnMapping[];
  /** Readings the graph build had to make, for the register on the confirm screen. */
  notes: IngestNote[];
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

/**
 * An FTE column is read as it stands, including zero.
 *
 * Zero is not a missing value in a workforce file — it is a statement that
 * the person holds no contracted establishment, which is how these systems
 * record agency and casual staffing. Rounding it up to 1 (as this used to)
 * silently converts several hundred agency workers into full-time employees
 * and inflates every FTE-based figure on every screen. A genuinely absent or
 * unreadable value is a different thing, and still reads as one full-time
 * equivalent.
 */
function parseFte(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

/**
 * A position at zero contracted FTE is agency staffing.
 *
 * This is a reading, not something the column says, and it is registered as
 * an assumption for the client to overrule. But it is the reading that makes
 * the map true: these people are on the establishment's org chart and doing
 * its work, and treating them as ordinary employees — or as an absence —
 * both misstate what the organisation is. `contingent` is the status Atlas
 * already holds for labour it does not employ.
 */
function agencyStatus(fte: number, stated: PositionStatus, hadStatusColumn: boolean): PositionStatus {
  // A file that states the status outright is believed over any inference.
  if (hadStatusColumn && stated !== "filled") return stated;
  return fte === 0 ? "contingent" : stated;
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
  /** Value of the consolidation column for this row; "" when not consolidating. */
  group: string;
}

/**
 * A heading node: the "Northern Brand" box that three separate hierarchies
 * hang under once an establishment is consolidated. It is drawn like a
 * position because the map only draws positions, but it costs nothing, holds
 * nobody, and is excluded from every metric — see `synthetic` on Position.
 */
function syntheticNode(
  id: string,
  orgId: string,
  label: string,
  department: string,
  managerId: string | null
): Position {
  return {
    id,
    orgId,
    rawName: null,
    displayName: label,
    title: label,
    department,
    managerId,
    cost: 0,
    fte: 0,
    status: "filled",
    clinicalFlag: false,
    sourceRowIndex: -1,
    confidence: { name: 1, title: 1, department: 1, manager: 1, classification: 1 },
    classificationSource: "fallback",
    synthetic: true,
  };
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

    const fte = fteCol ? parseFte(row[fteCol]) : 1;

    rawRows.push({
      sourceRowIndex: index,
      positionIdRaw,
      rawName: (nameCol ? row[nameCol] : "").trim() || `Unnamed row ${index + 2}`,
      title: (titleCol ? row[titleCol] : "").trim() || "Unspecified title",
      department: (deptCol ? row[deptCol] : "").trim() || UNCLASSIFIED,
      managerNameRaw: (managerCol ? row[managerCol] : "").trim(),
      cost: costCol ? parseCost(row[costCol]) : 0,
      fte,
      status: agencyStatus(fte, statusCol ? parseStatus(row[statusCol]) : "filled", Boolean(statusCol)),
      group: options.groupBy ? (row[options.groupBy.column] ?? "").trim() : "",
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

  // --- consolidation ------------------------------------------------------
  // Several brands, entities or sites in one upload arrive as several
  // unconnected hierarchies. Without this they are forced into one by picking
  // whichever chief executive appeared first and hanging the other brands'
  // leadership under them — a reporting line that does not exist. Grouping
  // gives each its own heading and puts the headings under one node, so the
  // map is a single tree that still says which brand each part belongs to.
  const syntheticPositions: Position[] = [];
  const groupNodeId = new Map<string, string>();
  let topNodeId: string | null = null;

  const groupValues = options.groupBy
    ? [...new Set(rawRows.map((r) => r.group).filter((v) => v !== ""))]
    : [];

  if (options.groupBy && groupValues.length >= 2) {
    const { label, topLabel, column } = options.groupBy;
    topNodeId = randomUUID();
    syntheticPositions.push(syntheticNode(topNodeId, options.orgId, topLabel, "—", null));

    for (const value of groupValues) {
      const id = randomUUID();
      groupNodeId.set(value, id);
      syntheticPositions.push(syntheticNode(id, options.orgId, value, value, topNodeId));
    }

    const ungrouped = rawRows.filter((r) => r.group === "").length;
    issues.push({
      id: randomUUID(),
      orgId: options.orgId,
      kind: "conversion",
      positionId: null,
      detail:
        `Consolidated at ${label.toLowerCase()} level on the "${column}" column: ${groupValues.length} ` +
        `${label.toLowerCase()}s — ${groupValues.join(", ")} — each given a heading under "${topLabel}". ` +
        `Those ${groupValues.length + 1} headings are structure, not jobs: they hold no one, cost nothing, ` +
        `and are left out of every count on the following screens.` +
        (ungrouped > 0
          ? ` ${ungrouped} row${ungrouped === 1 ? " has" : "s have"} no value in that column and ${ungrouped === 1 ? "sits" : "sit"} directly under "${topLabel}".`
          : ""),
      resolved: true,
    });
  } else if (options.groupBy) {
    issues.push({
      id: randomUUID(),
      orgId: options.orgId,
      kind: "conversion",
      positionId: null,
      detail:
        `Atlas was asked to consolidate at ${options.groupBy.label.toLowerCase()} level on the ` +
        `"${options.groupBy.column}" column, but ${groupValues.length === 1 ? `every row carries the same value ("${groupValues[0]}")` : "no row carries a value"} — ` +
        `there was nothing to consolidate, so the establishment was built as one structure.`,
      resolved: true,
    });
  }

  const headingFor = (r: { row: RawRow }): string | null =>
    topNodeId === null ? null : (groupNodeId.get(r.row.group) ?? topNodeId);

  // Pick the root: prefer a title match on chief-executive keywords among
  // the no-manager rows; otherwise the first no-manager row. Every other
  // no-manager row is an unresolved orphan needing attachment, but the
  // chosen root is never counted as one. When consolidating, the root is the
  // top heading instead, and every natural top-of-tree keeps its seniority
  // under its own heading rather than being demoted under a peer.
  const noManagerRows = resolved.filter((r) => r.managerId === null && !r.orphan);
  let rootEntry: Resolved | undefined;

  if (topNodeId !== null) {
    for (const r of noManagerRows) {
      r.managerId = headingFor(r);
      r.managerConfidence = 0.8;
    }
  } else {
    rootEntry =
      noManagerRows.find((r) =>
        CHIEF_EXECUTIVE_KEYWORDS.some((k) => r.row.title.toLowerCase().includes(k))
      ) ?? noManagerRows[0];

    if (rootEntry) {
      for (const r of noManagerRows) {
        if (r.id !== rootEntry.id) r.orphan = true;
      }
    }
  }

  // Attach orphans: prefer another already-anchored, management-looking
  // position in the same department; otherwise lift to root — or, when
  // consolidating, to the heading for that row's own group, so an orphan in
  // one brand is never quietly parented into another.
  const anchored = resolved.filter((r) => !r.orphan && r.managerId !== null);

  for (const r of resolved) {
    if (!r.orphan) continue;

    const deptManager = anchored.find(
      (a) =>
        a.row.department === r.row.department &&
        (topNodeId === null || a.row.group === r.row.group) &&
        looksLikeManagement(a.row.title)
    );

    if (deptManager) {
      r.managerId = deptManager.id;
      r.managerConfidence = 0.4;
    } else if (topNodeId !== null) {
      r.managerId = headingFor(r);
      r.managerConfidence = 0.3;
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
        deptManager
          ? `attached to ${deptManager.row.title} by department`
          : topNodeId !== null
            ? `placed under its ${options.groupBy!.label.toLowerCase()} heading`
            : "lifted to the top"
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
        r.managerId = topNodeId !== null ? headingFor(r) : (rootEntry?.id ?? null);
        // The reference resolved perfectly well — it just pointed into a loop,
        // so the line had to be discarded to produce a tree at all. That is
        // not a confident reporting line, and anything checking the map
        // against the client's own chart has to be able to tell this apart
        // from a manager that simply could not be found.
        r.managerConfidence = 0.2;
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

  // Every distinct role is classified once, in batches, before any position
  // is assembled. Classifying per position instead would cost one API call
  // per row — invisible on a deployment with no key, and an ingest that
  // never returns on one with a key and a real client establishment.
  const classifications = await classifyRoles(
    resolved.map((r) => ({ title: r.row.title, department: r.row.department }))
  );

  const positions: Position[] = resolved.map((r) => {
    const classification: RoleClassification = classifications.get(
      roleKey(r.row.title, r.row.department)
    ) ?? {
      managementLevel: "individual_contributor",
      clinicalFlag: false,
      confidence: 0.6,
      source: "fallback",
    };

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
      synthetic: false,
    } satisfies Position;
  });

  // Headings first, so the root of the map is the first row with no manager.
  return {
    positions: [...syntheticPositions, ...positions],
    issues,
    columnMapping,
    notes: agencyNote(positions, Boolean(fteCol)),
  };
}

/**
 * States the agency reading, because it is a reading.
 *
 * Zero FTE meaning "agency" is true of the workforce systems these files come
 * out of, and it is not written down anywhere in the file. It changes who
 * appears on the map as employed labour and who appears as bought-in, which
 * is one of the first things a redesign conversation turns on — so it belongs
 * in the register, with the count, rather than in a code comment.
 */
function agencyNote(positions: Position[], hadFteColumn: boolean): IngestNote[] {
  const agency = positions.filter((p) => !p.synthetic && p.fte === 0);
  if (!hadFteColumn || agency.length === 0) return [];

  const employed = positions.filter((p) => !p.synthetic).length - agency.length;
  const departments = [...new Set(agency.map((p) => p.department))].filter(
    (d) => d !== UNCLASSIFIED
  );

  return [
    note("agency-zero-fte", "assumption", {
      topic: "Agency staffing",
      statement: `${agency.length.toLocaleString()} positions record 0 FTE, and Atlas has read every one of them as agency staffing rather than as employed headcount.`,
      evidence:
        `Zero contracted FTE alongside a live pay rate is how these systems record labour the organisation ` +
        `uses but does not employ. They are shown on the map as contingent and can be filtered to on their own` +
        (departments.length > 0
          ? `, and they sit across ${departments.length} department${departments.length === 1 ? "" : "s"}` +
            (departments.length <= 4 ? ` — ${departments.join(", ")}` : "")
          : "") +
        `. The other ${employed.toLocaleString()} positions carry contracted FTE and read as employed.`,
      effect:
        `Agency staff contribute headcount but no establishment FTE, so they carry no cost in a cost × FTE ` +
        `model — that is what a 0 FTE row means arithmetically. Redesign plays that in-house contingent labour ` +
        `read this population; if any of them are actually employees whose FTE was left blank, say so and ` +
        `Atlas will read the column differently.`,
    }),
  ];
}
