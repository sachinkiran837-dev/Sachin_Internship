import { mapColumns } from "./columnMapper";
import type { ConversionReport, ParsedFile } from "./parseFile";
import { CANONICAL_FIELDS } from "@/lib/graph/types";

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
 * - anything with no usable key is **unusable**, and is reported as such
 *   rather than quietly ignored.
 *
 * Every file's fate is recorded in a FileBinding and surfaced on the confirm
 * screen. A file that contributed nothing must say so — the failure mode
 * this guards against is a client uploading five files, seeing a map, and
 * never learning that three of them were dropped.
 */

export type FileRole = "roster" | "attributes" | "unusable";

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
}

export interface BoundDataset extends ParsedFile {
  bindings: FileBinding[];
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
}

const key = (v: string) => v.trim().toLowerCase();

/**
 * Re-keys a file's rows onto canonical field names so two files that call
 * the same thing "Manager ID" and "reportsTo" can be joined at all.
 * Unmapped columns keep their original header — they may be exactly the
 * client-specific field someone wants to see later.
 */
function normalise(file: ReadableFile): NormalisedFile {
  const mapping = mapColumns(file.parsed.headers);
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

  const rows = file.parsed.rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [col, value] of Object.entries(row)) {
      out[rename.get(col) ?? col] = value;
    }
    return out;
  });

  const columns = mapping.map((m) => ({ column: m.sourceColumn, field: m.targetField }));

  return { filename: file.filename, parsed: file.parsed, rows, fields, extras, columns };
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

export function bindFiles(files: SourceFile[]): BoundDataset {
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
    });
  }

  if (readable.length === 0) {
    return {
      headers: [],
      rows: [],
      bindings,
      conversion: {
        sourceFormat: "—",
        detail: `None of the ${files.length} uploaded file${files.length === 1 ? "" : "s"} could be read.`,
        rowCount: 0,
      },
    };
  }

  const normalised = readable.map(normalise);

  let rosters = normalised.filter(isRoster);
  const others = normalised.filter((f) => !isRoster(f));

  // If nothing looks like a roster, the richest file has to serve as one —
  // better to build something reviewable than to refuse the whole upload.
  let promoted: NormalisedFile | null = null;
  if (rosters.length === 0) {
    promoted = [...normalised].sort((a, b) => b.fields.size - a.fields.size)[0];
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

    bindings.push({
      filename: roster.filename,
      role: "roster",
      rowCount: roster.rows.length,
      joinKey: null,
      matchedRows: added,
      unmatchedRows: skipped,
      contributedFields: [...roster.fields, ...roster.extras],
      conflicts: 0,
      sourceFormat: roster.parsed.conversion.sourceFormat,
      conversionDetail: roster.parsed.conversion.detail,
      columns: roster.columns,
      needsReview: Boolean(roster.parsed.conversion.needsReview),
      detail:
        (promoted === roster
          ? `No file in this upload looked like a position list, so this one was used as the establishment — check the columns below carefully. `
          : "") +
        `Read as a position list: ${added} row${added === 1 ? "" : "s"} added to the establishment` +
        (skipped > 0
          ? `, ${skipped} skipped as already present in an earlier file.`
          : rosters.length > 1
            ? ", stacked with the other position lists in this upload."
            : "."),
    });
  }

  // --- join the attribute files -----------------------------------------
  for (const f of others) {
    const joinKey = joinableOn(f, coreFields);

    if (!joinKey) {
      bindings.push({
        filename: f.filename,
        role: "unusable",
        rowCount: f.rows.length,
        joinKey: null,
        matchedRows: 0,
        unmatchedRows: f.rows.length,
        contributedFields: [],
        conflicts: 0,
        sourceFormat: f.parsed.conversion.sourceFormat,
        conversionDetail: f.parsed.conversion.detail,
        columns: f.columns,
        needsReview: Boolean(f.parsed.conversion.needsReview),
        detail:
          `Not used. Atlas could not find a position ID or a name in this file to match against the establishment, ` +
          `so there is no safe way to attach its ${f.rows.length} row${f.rows.length === 1 ? "" : "s"}. ` +
          `Columns found: ${f.parsed.headers.slice(0, 6).join(", ")}${f.parsed.headers.length > 6 ? ", …" : ""}.`,
      });
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

    bindings.push({
      filename: f.filename,
      role: "attributes",
      rowCount: f.rows.length,
      joinKey,
      matchedRows: matched,
      unmatchedRows: unmatched,
      contributedFields: [...contributed],
      conflicts,
      sourceFormat: f.parsed.conversion.sourceFormat,
      conversionDetail: f.parsed.conversion.detail,
      columns: f.columns,
      needsReview: Boolean(f.parsed.conversion.needsReview),
      detail:
        `Joined onto the establishment by ${joinKey === "positionId" ? "position ID" : "name"}: ` +
        `${matched} of ${f.rows.length} row${f.rows.length === 1 ? "" : "s"} matched` +
        (contributed.size > 0
          ? `, filling ${[...contributed].map(fieldLabel).join(", ")}.`
          : ", but every value it offered was already present.") +
        (unmatched > 0 ? ` ${unmatched} row${unmatched === 1 ? "" : "s"} matched nothing and ${unmatched === 1 ? "was" : "were"} left out.` : "") +
        (conflicts > 0
          ? ` ${conflicts} value${conflicts === 1 ? "" : "s"} disagreed with the position list and the position list was kept.`
          : ""),
    });
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

  return {
    headers,
    rows,
    bindings,
    conversion: summarise(readable, files.length, bindings, rows.length),
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
  const unusable = bindings.filter((b) => b.role === "unusable").length;

  if (totalFiles === 1) {
    return { ...readable[0].parsed.conversion, rowCount };
  }

  return {
    sourceFormat: formats.join(" + "),
    detail:
      `Bound ${totalFiles} files into one establishment: ` +
      `${rosters} position list${rosters === 1 ? "" : "s"}` +
      (joined > 0 ? `, ${joined} joined for extra detail` : "") +
      (unusable > 0 ? `, ${unusable} not usable` : "") +
      ".",
    rowCount,
  };
}
