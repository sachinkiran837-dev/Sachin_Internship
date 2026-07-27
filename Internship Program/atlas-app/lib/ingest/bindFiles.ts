import { mapColumns } from "./columnMapper";
import type { ConversionReport, ParsedFile } from "./parseFile";
import { matchHeader, type FileUse, type IngestPlan, type RowFilter } from "./plan";
import { EMPTY_ANSWERS, mapValue, type IngestAnswers } from "./answers";
import { note, type IngestNote } from "./notes";
import { CANONICAL_FIELDS, type ColumnMapping } from "@/lib/graph/types";

/**
 * Binds several uploaded files into the one table the graph builder reads.
 *
 * Org data almost never arrives as a single tidy export. It arrives as an
 * establishment list plus a payroll extract plus a vacancy report plus a
 * roster, each from a different system, each naming the same field
 * differently, and often each covering only part of the organisation. The
 * job here is to work out what each file *is* before deciding what to do
 * with it:
 *
 * - a **roster** describes positions (it has a title, and an identity or a
 *   reporting line). Rosters are stacked on top of each other, so an
 *   establishment split by site or division reassembles into one org.
 * - an **attribute** file describes *facts about* positions (an id or a
 *   name, plus columns like cost, FTE or status). These are joined onto the
 *   roster rather than appended, so a payroll file supplies the salary the
 *   establishment list left blank.
 * - a **structure** file describes *who reports to whom* and little else —
 *   the shape read out of a chart. It is laid over the roster, replacing its
 *   reporting lines, rather than stacked as another set of people.
 * - anything with no usable key is **unusable**, and is reported as such
 *   rather than quietly ignored.
 *
 * Left to itself this is decided by what each file contains. An `IngestPlan`
 * — the reading of the instructions the user typed on the upload screen —
 * overrides it, which is the only way to express things the columns cannot
 * say: that the spreadsheet is payroll rather than the establishment, that
 * the chart is the source of truth for reporting lines, that a column called
 * "Entity" is the brand to consolidate on. The plan decides; every row
 * operation below is still deterministic.
 *
 * Every file's fate is recorded in a FileBinding and surfaced on the confirm
 * screen. A file that contributed nothing must say so — the failure mode
 * this guards against is a client uploading five files, seeing a map, and
 * never learning that three of them were dropped.
 */

export type FileRole = "roster" | "attributes" | "structure" | "excluded" | "unusable";

/** One source column and the canonical field it was recognised as, if any. */
export interface ColumnReading {
  column: string;
  field: string | null;
}

export interface FileBinding {
  filename: string;
  role: FileRole;
  rowCount: number;
  /** Canonical field the file was joined on; null for rosters and unusable files. */
  joinKey: string | null;
  matchedRows: number;
  unmatchedRows: number;
  /** Canonical fields or extra columns this file actually contributed. */
  contributedFields: string[];
  /** Values this file disagreed with the roster about — filled, never overwritten. */
  conflicts: number;
  detail: string;
  /** How the file itself was recognised — "Excel", "PDF", "JSON" and so on. */
  sourceFormat: string;
  /** What the reader did to it, before any binding: the conversion note. */
  conversionDetail: string;
  /**
   * Every column found, and what Atlas made of it. This is the part a client
   * argues with — "where did our cost centre column go?" — so it is kept
   * per-file rather than collapsed into the combined header list.
   */
  columns: ColumnReading[];
  /** Rows a model transcribed rather than read from an export. */
  needsReview: boolean;
  /** Why the user's instructions put this file in this role, in the planner's words. */
  planReason: string | null;
}

export interface BoundDataset extends ParsedFile {
  bindings: FileBinding[];
  /** The consolidation column, resolved to the name it carries in `rows`. */
  groupBy: { column: string; label: string; topLabel: string } | null;
  /**
   * Every distinct value of the consolidation column, and which files it was
   * seen in. Two files that name the same brand differently show up here as
   * two values each seen in one file, which is what makes the mismatch
   * detectable at all rather than silently doubling the groups on the map.
   */
  groupValues: { value: string; files: string[]; count: number }[];
  /** Rows dropped before binding because the plan restricted the scope. */
  filteredOut: number;
}

export interface SourceFile {
  filename: string;
  parsed?: ParsedFile;
  /**
   * Why this file couldn't be read at all. A file that fails is reported
   * alongside the ones that worked rather than aborting the upload — one
   * unreadable file among five is not a reason to refuse the other four,
   * and refusing the batch is indistinguishable to the user from the whole
   * feature being broken.
   */
  error?: string;
}

type ReadableFile = SourceFile & { parsed: ParsedFile };

type CanonicalField = keyof typeof CANONICAL_FIELDS;

const CANONICAL_ORDER: CanonicalField[] = [
  "positionId",
  "name",
  "title",
  "department",
  "managerName",
  "cost",
  "fte",
  "status",
];

interface NormalisedFile {
  filename: string;
  parsed: ParsedFile;
  /** Rows re-keyed to canonical field names, with unmapped columns preserved. */
  rows: Record<string, string>[];
  fields: Set<CanonicalField>;
  extras: string[];
  columns: ColumnReading[];
  /** What the plan said this file is for, if it said anything. */
  use: FileUse | null;
  planReason: string | null;
  /** Rows this file lost to the plan's scope filter. */
  filteredOut: number;
  /** This file's own name for the consolidation column, if it carries one. */
  groupColumn: string | null;
}

const key = (v: string) => v.trim().toLowerCase();

/**
 * Re-keys a file's rows onto canonical field names so two files that call
 * the same thing "Manager ID" and "reportsTo" can be joined at all.
 * Unmapped columns keep their original header — they may be exactly the
 * client-specific field someone wants to see later.
 */
function normalise(
  file: ReadableFile,
  plan: IngestPlan | null,
  answers: IngestAnswers
): NormalisedFile {
  const filePlan = plan?.files.find((f) => f.filename === file.filename) ?? null;
  const mapping = applyOverrides(mapColumns(file.parsed.headers), filePlan?.columns ?? {});

  const fields = new Set<CanonicalField>();
  const extras: string[] = [];

  const rename = new Map<string, string>();
  for (const m of mapping) {
    if (m.targetField) {
      fields.add(m.targetField as CanonicalField);
      rename.set(m.sourceColumn, m.targetField);
    } else {
      extras.push(m.sourceColumn);
      rename.set(m.sourceColumn, m.sourceColumn);
    }
  }

  // Scope is applied against the original column, before renaming, because
  // that is the name the user and the planner both saw.
  const kept = applyFilter(file.parsed.rows, plan?.rowFilter ?? null);

  // The consolidation dimension is read off this file's own column and
  // written into one column shared by every file — otherwise a payroll
  // extract calling it "Source Brand" and a staff list calling it "BRAND"
  // would produce two half-empty columns and consolidating on either would
  // leave the other file's people ungrouped.
  const groupColumn = plan?.groupBy
    ? (plan.groupBy.columns.map((c) => matchHeader(c, file.parsed.headers)).find(Boolean) ?? null)
    : null;
  const groupLabel = plan?.groupBy?.label ?? null;

  const rows = kept.rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [col, value] of Object.entries(row)) {
      out[rename.get(col) ?? col] = value;
    }
    if (groupColumn && groupLabel) {
      // Vocabularies the client has already reconciled are applied here, at
      // the one place the raw value is still in hand.
      const raw = (row[groupColumn] ?? "").trim();
      if (raw) out[groupLabel] = mapValue(answers, groupLabel, raw);
    }
    return out;
  });

  if (groupColumn && groupLabel && !extras.includes(groupLabel)) extras.push(groupLabel);

  const columns = mapping.map((m) => ({ column: m.sourceColumn, field: m.targetField }));

  return {
    filename: file.filename,
    parsed: file.parsed,
    rows,
    fields,
    extras,
    columns,
    use: filePlan?.use ?? null,
    planReason: filePlan?.reason?.trim() || null,
    filteredOut: kept.dropped,
    groupColumn,
  };
}

/**
 * The plan's column decisions beat the synonym matcher's. A column the plan
 * names takes that field outright, and any column that had claimed the field
 * automatically gives it up — otherwise both would map to it and one would
 * silently win, which is the exact failure the matcher was hardened against.
 */
function applyOverrides(
  mapping: ColumnMapping[],
  overrides: Record<string, string>
): ColumnMapping[] {
  const forced = new Map(Object.entries(overrides));
  if (forced.size === 0) return mapping;

  const takenByPlan = new Set([...forced.values()].filter((f) => f !== "ignore"));

  return mapping.map((m) => {
    const override = forced.get(m.sourceColumn);

    if (override === "ignore") {
      return { ...m, targetField: null, confidence: 0, autoMapped: false };
    }
    if (override) {
      return {
        ...m,
        targetField: override as CanonicalField,
        confidence: 1,
        autoMapped: false,
      };
    }
    if (m.targetField && takenByPlan.has(m.targetField)) {
      return { ...m, targetField: null, confidence: 0, autoMapped: false };
    }
    return m;
  });
}

/** Keeps only the rows the plan's scope allows. A file without the column is untouched. */
function applyFilter(
  rows: Record<string, string>[],
  filter: RowFilter | null
): { rows: Record<string, string>[]; dropped: number } {
  if (!filter || rows.length === 0 || !(filter.column in rows[0])) {
    return { rows, dropped: 0 };
  }

  const include = new Set(filter.include.map(key));
  const exclude = new Set(filter.exclude.map(key));

  const kept = rows.filter((row) => {
    const value = key(row[filter.column] ?? "");
    if (exclude.has(value)) return false;
    if (include.size > 0 && !include.has(value)) return false;
    return true;
  });

  return { rows: kept, dropped: rows.length - kept.length };
}

/**
 * A file describes positions if it says what the role *is* and can identify
 * it. Without a title it can only ever be an attribute of someone else's
 * roster, however many rows it has.
 */
function isRoster(f: NormalisedFile): boolean {
  return f.fields.has("title") && (f.fields.has("positionId") || f.fields.has("managerName") || f.fields.has("name"));
}

function joinableOn(f: NormalisedFile, coreFields: Set<CanonicalField>): CanonicalField | null {
  if (f.fields.has("positionId") && coreFields.has("positionId")) return "positionId";
  if (f.fields.has("name") && coreFields.has("name")) return "name";
  return null;
}

/** Fields an attribute file can usefully contribute, beyond the join key itself. */
function payloadFields(f: NormalisedFile, joinKey: CanonicalField): string[] {
  return [...[...f.fields].filter((x) => x !== joinKey), ...f.extras];
}

export function bindFiles(
  files: SourceFile[],
  plan: IngestPlan | null = null,
  answers: IngestAnswers = EMPTY_ANSWERS
): BoundDataset {
  if (files.length === 0) {
    throw new Error("No files to bind.");
  }

  const readable = files.filter((f): f is ReadableFile => Boolean(f.parsed));
  const bindings: FileBinding[] = [];

  // Files that couldn't be read at all are reported first, in upload order,
  // so the reader sees them next to the ones that worked.
  for (const f of files) {
    if (f.parsed) continue;
    bindings.push({
      filename: f.filename,
      role: "unusable",
      rowCount: 0,
      joinKey: null,
      matchedRows: 0,
      unmatchedRows: 0,
      contributedFields: [],
      conflicts: 0,
      detail: `Not used. ${f.error ?? "Atlas could not read this file."}`,
      sourceFormat: "—",
      conversionDetail: "The file could not be read, so nothing was taken from it.",
      columns: [],
      needsReview: false,
      planReason: null,
    });
  }

  if (readable.length === 0) {
    return {
      headers: [],
      rows: [],
      bindings,
      groupBy: null,
      groupValues: [],
      filteredOut: 0,
      conversion: {
        sourceFormat: "—",
        detail: `None of the ${files.length} uploaded file${files.length === 1 ? "" : "s"} could be read.`,
        rowCount: 0,
      },
    };
  }

  const normalised = readable.map((f) => normalise(f, plan, answers));

  // --- what each file is for --------------------------------------------
  for (const f of normalised.filter((f) => f.use === "ignore")) {
    bindings.push(
      baseBinding(f, {
        role: "excluded",
        detail:
          `Left out of this run on your instructions. ` +
          (f.planReason ?? "Your instructions said this file was not part of the establishment.") +
          ` Its ${f.rows.length} row${f.rows.length === 1 ? "" : "s"} were not read into the map.`,
      })
    );
  }

  const usable = normalised.filter((f) => f.use !== "ignore");
  let structureFiles = usable.filter((f) => f.use === "structure");
  const candidates = usable.filter((f) => f.use !== "structure");

  let rosters = candidates.filter((f) => f.use === "positions" || (f.use === null && isRoster(f)));
  const others = candidates.filter((f) => !rosters.includes(f));

  // A picture is nearly always the shape, not the census. An org chart out of
  // a board pack shows twenty boxes and the lines between them; the payroll
  // spreadsheet beside it lists five hundred people and what they cost.
  // Stacking them duplicates the twenty and throws away the one thing the
  // chart is better at, so unless the instructions say otherwise, a file read
  // from a picture supplies the reporting lines and the export supplies
  // everyone. This is the division the instructions box exists to state,
  // applied by default when nobody states it — and said out loud on the
  // confirm screen, because it is a judgement rather than a reading.
  const inferredStructure = new Set<NormalisedFile>();
  if (rosters.some((f) => !f.parsed.conversion.needsReview)) {
    const pictures = rosters.filter((f) => f.use === null && f.parsed.conversion.needsReview);
    for (const p of pictures) inferredStructure.add(p);
    if (pictures.length > 0) {
      structureFiles = [...structureFiles, ...pictures];
      rosters = rosters.filter((f) => !inferredStructure.has(f));
    }
  }

  // A chart laid over nothing is just a chart. If the only files here are
  // structure files, they have to be the establishment as well as its shape.
  let structurePromoted = false;
  if (rosters.length === 0 && structureFiles.length > 0) {
    rosters = structureFiles;
    structureFiles = [];
    structurePromoted = true;
  }

  // If nothing looks like a roster, the richest file has to serve as one —
  // better to build something reviewable than to refuse the whole upload.
  let promoted: NormalisedFile | null = null;
  if (rosters.length === 0 && candidates.length > 0) {
    promoted = [...candidates].sort((a, b) => b.fields.size - a.fields.size)[0];
    rosters = [promoted];
  }

  // --- stack the rosters -------------------------------------------------
  const coreRows: Record<string, string>[] = [];
  const coreFields = new Set<CanonicalField>();
  const coreExtras: string[] = [];
  // Only cross-file duplicates are resolved here; duplicates *within* one
  // file stay for the graph builder to report, as it always has.
  const seenIds = new Map<string, string>();

  for (const roster of rosters) {
    let added = 0;
    let skipped = 0;

    for (const row of roster.rows) {
      const id = row.positionId?.trim();
      if (id) {
        const firstSeenIn = seenIds.get(id);
        if (firstSeenIn && firstSeenIn !== roster.filename) {
          skipped++;
          continue;
        }
        if (!firstSeenIn) seenIds.set(id, roster.filename);
      }
      coreRows.push({ ...row });
      added++;
    }

    for (const f of roster.fields) coreFields.add(f);
    for (const e of roster.extras) if (!coreExtras.includes(e)) coreExtras.push(e);

    bindings.push(
      baseBinding(roster, {
        role: "roster",
        matchedRows: added,
        unmatchedRows: skipped,
        contributedFields: [...roster.fields, ...roster.extras],
        detail:
          (roster.use === "positions"
            ? `Used as the establishment on your instructions. ${roster.planReason ? `${roster.planReason} ` : ""}`
            : structurePromoted
              ? `Read as a chart, and used as the establishment too — nothing else in this run listed who exists, so the boxes on the chart are the positions. `
              : promoted === roster
                ? `No file in this upload looked like a position list, so this one was used as the establishment — check the columns below carefully. `
                : "") +
          `Read as a position list: ${added} row${added === 1 ? "" : "s"} added to the establishment` +
          (skipped > 0
            ? `, ${skipped} skipped as already present in an earlier file.`
            : rosters.length > 1
              ? ", stacked with the other position lists in this upload."
              : "."),
      })
    );
  }

  // --- join the attribute files -----------------------------------------
  for (const f of others) {
    const joinKey = joinableOn(f, coreFields);

    if (!joinKey) {
      bindings.push(
        baseBinding(f, {
          role: "unusable",
          unmatchedRows: f.rows.length,
          detail:
            `Not used. Atlas could not find a position ID or a name in this file to match against the establishment, ` +
            `so there is no safe way to attach its ${f.rows.length} row${f.rows.length === 1 ? "" : "s"}. ` +
            `Columns found: ${f.parsed.headers.slice(0, 6).join(", ")}${f.parsed.headers.length > 6 ? ", …" : ""}.`,
        })
      );
      continue;
    }

    const index = new Map<string, Record<string, string>[]>();
    for (const row of coreRows) {
      const k = key(row[joinKey] ?? "");
      if (!k) continue;
      index.set(k, [...(index.get(k) ?? []), row]);
    }

    const payload = payloadFields(f, joinKey);
    let matched = 0;
    let unmatched = 0;
    let conflicts = 0;
    const contributed = new Set<string>();

    for (const row of f.rows) {
      const targets = index.get(key(row[joinKey] ?? ""));
      if (!targets || targets.length === 0) {
        unmatched++;
        continue;
      }
      matched++;

      for (const target of targets) {
        for (const field of payload) {
          const incoming = (row[field] ?? "").trim();
          if (!incoming) continue;

          const existing = (target[field] ?? "").trim();
          if (!existing) {
            target[field] = incoming;
            contributed.add(field);
          } else if (existing !== incoming) {
            // The roster wins. Silently overwriting a client's establishment
            // record with a payroll figure is exactly the kind of invisible
            // edit that destroys trust in the numbers downstream.
            conflicts++;
          }
        }
      }
    }

    for (const field of contributed) {
      if (CANONICAL_ORDER.includes(field as CanonicalField)) coreFields.add(field as CanonicalField);
      else if (!coreExtras.includes(field)) coreExtras.push(field);
    }

    bindings.push(
      baseBinding(f, {
        role: "attributes",
        joinKey,
        matchedRows: matched,
        unmatchedRows: unmatched,
        contributedFields: [...contributed],
        conflicts,
        detail:
          (f.use === "attributes" && f.planReason ? `${f.planReason} ` : "") +
          `Joined onto the establishment by ${joinKey === "positionId" ? "position ID" : "name"}: ` +
          `${matched} of ${f.rows.length} row${f.rows.length === 1 ? "" : "s"} matched` +
          (contributed.size > 0
            ? `, filling ${[...contributed].map(fieldLabel).join(", ")}.`
            : ", but every value it offered was already present.") +
          (unmatched > 0 ? ` ${unmatched} row${unmatched === 1 ? "" : "s"} matched nothing and ${unmatched === 1 ? "was" : "were"} left out.` : "") +
          (conflicts > 0
            ? ` ${conflicts} value${conflicts === 1 ? "" : "s"} disagreed with the position list and the position list was kept.`
            : ""),
      })
    );
  }

  // --- lay the structure files over the establishment ---------------------
  const bindNotes: IngestNote[] = [];
  for (const f of structureFiles) {
    bindings.push(
      overlayStructure(f, coreRows, coreFields, coreExtras, inferredStructure.has(f), bindNotes)
    );
  }

  const headers = [
    ...CANONICAL_ORDER.filter((f) => coreFields.has(f)),
    ...coreExtras,
  ];

  const rows = coreRows.map((row) => {
    const out: Record<string, string> = {};
    for (const h of headers) out[h] = row[h] ?? "";
    return out;
  });

  // Report the files back in the order they were uploaded, not in the order
  // the binder happened to process them — the reader is looking for the file
  // they just added, not for its role.
  const uploadOrder = new Map(files.map((f, i) => [f.filename, i] as const));
  bindings.sort(
    (a, b) => (uploadOrder.get(a.filename) ?? 0) - (uploadOrder.get(b.filename) ?? 0)
  );

  const groupBy = resolveGroupBy(plan, headers);

  return {
    headers,
    rows,
    bindings,
    groupBy,
    groupValues: groupBy ? countGroupValues(normalised, groupBy.column) : [],
    notes: [...readable.flatMap((f) => f.parsed.notes ?? []), ...bindNotes],
    filteredOut: normalised.reduce((sum, f) => sum + f.filteredOut, 0),
    conversion: summarise(readable, files.length, bindings, rows.length),
  };
}

/**
 * The consolidation column, named as it appears in the bound rows. Normally
 * that is the plan's label, because `normalise` coalesces every file's own
 * column into one under that name.
 */
function resolveGroupBy(
  plan: IngestPlan | null,
  headers: string[]
): BoundDataset["groupBy"] {
  if (!plan?.groupBy) return null;

  const { label, topLabel, columns } = plan.groupBy;
  if (headers.includes(label)) return { column: label, label, topLabel };

  // No file carried the dimension after binding — the column may have been
  // recognised as a canonical field and renamed ("Division" as `department`).
  for (const column of columns) {
    if (headers.includes(column)) return { column, label, topLabel };
    const canonical = mapColumns([column])[0]?.targetField ?? null;
    if (canonical && headers.includes(canonical)) return { column: canonical, label, topLabel };
  }

  return null;
}

/**
 * Every value of the consolidation column and the files it appeared in.
 * Counted per file rather than off the bound rows, because the whole point is
 * to notice that one file says "365 Care" and another says "365C" — which is
 * invisible once the rows are in one pile.
 */
function countGroupValues(
  normalised: NormalisedFile[],
  column: string
): BoundDataset["groupValues"] {
  const seen = new Map<string, { files: Set<string>; count: number }>();

  for (const f of normalised) {
    for (const row of f.rows) {
      const value = (row[column] ?? "").trim();
      if (!value) continue;
      const entry = seen.get(value) ?? { files: new Set<string>(), count: 0 };
      entry.files.add(f.filename);
      entry.count++;
      seen.set(value, entry);
    }
  }

  return [...seen.entries()]
    .map(([value, e]) => ({ value, files: [...e.files], count: e.count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Lays one file's reporting lines over the establishment without adding its
 * people twice. This is what "the structure is in the PDF, the numbers are in
 * the spreadsheet" actually requires: a chart names twenty roles and who they
 * report to; the payroll extract names five hundred people and what they
 * cost. Stacking them would double the twenty and leave the chart's shape
 * unused. Joining them the ordinary way would do nothing, because a reporting
 * line is not an empty field waiting to be filled — the roster usually has one
 * already, and it is the one the user has just said to replace.
 *
 * So each chart row is matched to its position in the establishment, and the
 * chart's manager reference is *translated* into the establishment's own
 * terms before being written: the chart says "reports to box-3", box-3 is the
 * Director of Operations, the Director of Operations is P101 in the
 * establishment, so the line written is P101. Without that translation the
 * reference would point at a row that doesn't exist and every position under
 * it would be orphaned.
 */
function overlayStructure(
  f: NormalisedFile,
  coreRows: Record<string, string>[],
  coreFields: Set<CanonicalField>,
  coreExtras: string[],
  /** True when Atlas chose this role itself rather than being told to. */
  inferred: boolean,
  notes: IngestNote[]
): FileBinding {
  const establishmentSize = coreRows.length;
  const byId = new Map<string, Record<string, string>>();
  const byName = new Map<string, Record<string, string>>();
  const titleCounts = new Map<string, number>();

  for (const row of coreRows) {
    const id = key(row.positionId ?? "");
    if (id && !byId.has(id)) byId.set(id, row);
    const name = key(row.name ?? "");
    if (name && !byName.has(name)) byName.set(name, row);
    const title = key(row.title ?? "");
    if (title) titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  }

  const byUniqueTitle = new Map<string, Record<string, string>>();
  for (const row of coreRows) {
    const title = key(row.title ?? "");
    if (title && titleCounts.get(title) === 1) byUniqueTitle.set(title, row);
  }

  // Pass 1 — find each chart row's position in the establishment.
  const match = new Map<number, Record<string, string>>();
  let matched = 0;

  f.rows.forEach((row, i) => {
    const found =
      byId.get(key(row.positionId ?? "")) ??
      byName.get(key(row.name ?? "")) ??
      byUniqueTitle.get(key(row.title ?? ""));
    if (found) {
      match.set(i, found);
      matched++;
    }
  });

  // A structure file that matches nobody is not this organisation's chart,
  // or the names in it are written differently. Either way, guessing would
  // append a second, parallel organisation to the map. Refuse instead.
  if (matched === 0) {
    return baseBinding(f, {
      role: "unusable",
      unmatchedRows: f.rows.length,
      detail:
        `Not used as the structure. None of its ${f.rows.length} role${f.rows.length === 1 ? "" : "s"} could be matched ` +
        `to anyone in the establishment by position ID, name or job title, so laying its reporting lines over the ` +
        `establishment would have built a second, parallel organisation rather than reshaping this one. ` +
        `Check that the names on the chart are spelt as they are in the position list.`,
    });
  }

  // Rows that matched nothing are roles the chart knows about and the
  // position list doesn't. They are added, so the shape stays whole.
  let added = 0;
  f.rows.forEach((row, i) => {
    if (match.has(i)) return;
    const fresh: Record<string, string> = { ...row };
    delete fresh.managerName;
    coreRows.push(fresh);
    match.set(i, fresh);
    added++;
  });

  // How the establishment names a manager. Chart references have to be
  // rewritten into whichever of the two the rest of the rows already use.
  const useId = coreRows.some((r) => (r.positionId ?? "").trim() !== "");

  // Pass 2 — index the chart's own rows, so "reports to X" can be followed
  // inside the chart before being translated.
  const chartById = new Map<string, number>();
  const chartByName = new Map<string, number>();
  const chartByTitle = new Map<string, number>();
  f.rows.forEach((row, i) => {
    const id = key(row.positionId ?? "");
    if (id && !chartById.has(id)) chartById.set(id, i);
    const name = key(row.name ?? "");
    if (name && !chartByName.has(name)) chartByName.set(name, i);
    const title = key(row.title ?? "");
    if (title && !chartByTitle.has(title)) chartByTitle.set(title, i);
  });

  let applied = 0;
  let unresolved = 0;

  f.rows.forEach((row, i) => {
    const target = match.get(i);
    if (!target) return;

    const reference = (row.managerName ?? "").trim();
    if (!reference) {
      // The chart's own top role. Clearing the roster's line is what makes it
      // the top of the consolidated structure too.
      if (target.managerName) target.managerName = "";
      return;
    }

    const ref = key(reference);
    const managerIndex = chartById.get(ref) ?? chartByName.get(ref) ?? chartByTitle.get(ref);
    const managerRow = managerIndex === undefined ? undefined : match.get(managerIndex);

    if (!managerRow) {
      // Untranslatable, but the graph builder resolves manager references by
      // name as well as by ID, so the raw value still has a chance.
      target.managerName = reference;
      unresolved++;
      return;
    }

    const value = useId
      ? (managerRow.positionId ?? "").trim() || (managerRow.name ?? "").trim()
      : (managerRow.name ?? "").trim() || (managerRow.positionId ?? "").trim();

    target.managerName = value || reference;
    applied++;
  });

  // The reporting line has to be in the combined header list or it is dropped
  // when the rows are rebuilt — including when the roster had no manager
  // column at all, which is exactly the case this feature exists for.
  coreFields.add("managerName");
  for (const field of f.fields) {
    if (added > 0 && CANONICAL_ORDER.includes(field)) coreFields.add(field);
  }
  if (added > 0) {
    for (const extra of f.extras) if (!coreExtras.includes(extra)) coreExtras.push(extra);
  }

  // The chart and the spreadsheets are two accounts of one organisation, and
  // they disagree. Which way they disagree is the finding: roles drawn but
  // not paid are usually a chart drawn at a different date, and people paid
  // but not drawn are usually a chart that only ever covered head office.
  // Atlas states both counts and neither reconciles them, because deciding
  // which document is right is the client's call, not a reader's.
  const notOnChart = establishmentSize - matched;
  if (notOnChart > 0 || added > 0) {
    notes.push(
      note("structure-coverage", "question", {
        topic: "Chart against payroll",
        statement: `The structure in "${f.filename}" and the position lists beside it do not describe the same set of people, and Atlas has kept both rather than choosing.`,
        evidence:
          `${matched.toLocaleString()} of the chart's ${f.rows.length.toLocaleString()} roles were matched to someone in the position lists. ` +
          (added > 0
            ? `${added.toLocaleString()} role${added === 1 ? " was" : "s were"} drawn on the chart but appear in no spreadsheet, and ${added === 1 ? "was" : "were"} added with no cost. `
            : "") +
          (notOnChart > 0
            ? `${notOnChart.toLocaleString()} people are in the spreadsheets but nowhere on the chart, so nothing states who they report to.`
            : ""),
        effect:
          (notOnChart > 0
            ? `Those ${notOnChart.toLocaleString()} attach where Atlas can best place them rather than where the organisation puts them, which distorts spans of control and layer counts. `
            : "") +
          `Tell Atlas which document is current, or supply the reporting lines for the people the chart doesn't cover.`,
      })
    );
  }

  return baseBinding(f, {
    role: "structure",
    matchedRows: matched,
    unmatchedRows: f.rows.length - matched,
    contributedFields: ["managerName"],
    detail:
      (f.planReason
        ? `${f.planReason} `
        : inferred
          ? `Read from a picture, so Atlas took it as the shape of the organisation rather than a list of who is in it — the position list beside it already says who exists. Say so in the instructions box on the upload screen if that is the wrong way round. `
          : "") +
      `Used for its shape, not its people: ${matched} of its ${f.rows.length} role${f.rows.length === 1 ? "" : "s"} ` +
      `were matched to the establishment and ${applied} reporting line${applied === 1 ? "" : "s"} taken from it, ` +
      `replacing whatever the position list said.` +
      (added > 0
        ? ` ${added} role${added === 1 ? " was" : "s were"} on the chart but not in the position list, and ${added === 1 ? "was" : "were"} added.`
        : "") +
      (unresolved > 0
        ? ` ${unresolved} reporting line${unresolved === 1 ? "" : "s"} pointed at a box Atlas could not place, and ${unresolved === 1 ? "was" : "were"} left for the graph builder to resolve by name.`
        : ""),
  });
}

/** The parts of a binding that come straight off the file, in one place. */
function baseBinding(f: NormalisedFile, overrides: Partial<FileBinding>): FileBinding {
  return {
    filename: f.filename,
    role: "unusable",
    rowCount: f.rows.length,
    joinKey: null,
    matchedRows: 0,
    unmatchedRows: 0,
    contributedFields: [],
    conflicts: 0,
    detail: "",
    sourceFormat: f.parsed.conversion.sourceFormat,
    conversionDetail: f.parsed.conversion.detail,
    columns: f.columns,
    needsReview: Boolean(f.parsed.conversion.needsReview),
    planReason: f.planReason,
    ...overrides,
  };
}

function fieldLabel(field: string): string {
  return (CANONICAL_FIELDS as Record<string, string>)[field] ?? field;
}

function summarise(
  readable: ReadableFile[],
  totalFiles: number,
  bindings: FileBinding[],
  rowCount: number
): ConversionReport {
  const formats = [...new Set(readable.map((f) => f.parsed.conversion.sourceFormat))];
  const rosters = bindings.filter((b) => b.role === "roster").length;
  const joined = bindings.filter((b) => b.role === "attributes").length;
  const structure = bindings.filter((b) => b.role === "structure").length;
  const excluded = bindings.filter((b) => b.role === "excluded").length;
  const unusable = bindings.filter((b) => b.role === "unusable").length;

  if (totalFiles === 1 && structure === 0 && excluded === 0) {
    return { ...readable[0].parsed.conversion, rowCount };
  }

  return {
    sourceFormat: formats.join(" + "),
    detail:
      `Bound ${totalFiles} files into one establishment: ` +
      `${rosters} position list${rosters === 1 ? "" : "s"}` +
      (joined > 0 ? `, ${joined} joined for extra detail` : "") +
      (structure > 0 ? `, ${structure} used for reporting lines` : "") +
      (excluded > 0 ? `, ${excluded} left out on your instructions` : "") +
      (unusable > 0 ? `, ${unusable} not usable` : "") +
      ".",
    rowCount,
  };
}
