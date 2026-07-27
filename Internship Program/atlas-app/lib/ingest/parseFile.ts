import * as XLSX from "xlsx";
import { formatFor, unsupportedMessage } from "./formats";
import type { IngestNote } from "./notes";

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
  /** How the source was recognised and normalised — surfaced in the UI, never silent. */
  conversion: ConversionReport;
  /**
   * What reading this file forced Atlas to assume, and what it refused to
   * assume and needs answering. Raised on the confirm screen before the map.
   * See `lib/ingest/notes.ts`.
   */
  notes?: IngestNote[];
}

export interface ConversionReport {
  sourceFormat: string;
  detail: string;
  rowCount: number;
  /**
   * Set only when a model produced the rows rather than reading someone
   * else's export (an org chart transcribed from an image). Raised on the
   * confirm screen as a low-confidence issue — these rows are a starting
   * point, not a baseline.
   */
  needsReview?: string;
}

export class UnsupportedFileError extends Error {}

// Everything not listed here (.xlsx/.xlsm/.xls/.ods/.html/.htm) is handed to
// the workbook reader, which is the correct fallback for any spreadsheet
// format the xlsx library recognises.
const DELIMITED_EXTENSIONS: string[] = [".csv", ".tsv", ".txt", ".psv"];

/**
 * Parses any supported *tabular* establishment export into headers + rows —
 * the CSV shape the column mapper and graph builder expect. Every branch
 * either produces a real table or throws: an empty sheet, a header-only file,
 * a JSON blob with no array of records, or an unrecognised extension all fail
 * loudly rather than importing a partial result.
 *
 * Word documents, images and PDFs go through `readSourceFile` instead, which
 * routes to the readers that need to be asynchronous.
 */
export function parseEstablishmentFile(filename: string, buffer: Buffer): ParsedFile {
  const format = formatFor(filename);

  if (!format) {
    throw new UnsupportedFileError(unsupportedMessage(filename));
  }

  if (format.kind !== "table") {
    // A caller mistake rather than a bad upload: this reader is synchronous
    // and the other formats can't be.
    throw new Error(
      `"${filename}" is a ${format.label} file — read it with readSourceFile(), not parseEstablishmentFile().`
    );
  }

  const ext = format.ext;

  if (ext === ".json") return finalise(parseJson(filename, buffer), filename);
  if (ext === ".xml") return finalise(parseXml(filename, buffer), filename);
  if (DELIMITED_EXTENSIONS.includes(ext)) return finalise(parseDelimited(filename, buffer, ext), filename);
  return finalise(parseWorkbook(filename, buffer, ext), filename);
}

type RawParse = { rows: Record<string, string>[]; conversion: Omit<ConversionReport, "rowCount"> };

function finalise(parsed: RawParse, filename: string): ParsedFile {
  const { rows } = parsed;

  if (rows.length === 0) {
    throw new UnsupportedFileError(`"${filename}" has no data rows below the header row.`);
  }

  // Union of all keys, not just the first row's — JSON and XML records are
  // commonly ragged, and dropping a column because row 1 omitted it would
  // silently lose a field the column mapper needs.
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }

  if (headers.length === 0) {
    throw new UnsupportedFileError(`"${filename}" has no recognisable header row.`);
  }

  const normalised = rows.map((row) => {
    const out: Record<string, string> = {};
    for (const header of headers) out[header] = row[header] ?? "";
    return out;
  });

  return {
    headers,
    rows: normalised,
    conversion: { ...parsed.conversion, rowCount: normalised.length },
  };
}

/**
 * Sniffs the delimiter rather than trusting the extension — HR systems
 * routinely export semicolon- or tab-separated data with a .csv name.
 * Wins on the candidate with the most consistent column count across the
 * first few lines, which is a stronger signal than raw frequency (a
 * free-text notes column full of commas would otherwise win).
 */
function sniffDelimiter(sample: string): { delimiter: string; label: string } {
  const candidates = [
    { delimiter: ",", label: "comma" },
    { delimiter: "\t", label: "tab" },
    { delimiter: ";", label: "semicolon" },
    { delimiter: "|", label: "pipe" },
  ];

  const lines = sample
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .slice(0, 10);

  if (lines.length === 0) return candidates[0];

  let best = candidates[0];
  let bestScore = -1;

  for (const candidate of candidates) {
    const counts = lines.map((line) => splitDelimitedLine(line, candidate.delimiter).length);
    const first = counts[0];
    if (first < 2) continue;
    const consistent = counts.filter((c) => c === first).length;
    // Favour consistency first, then column count as the tiebreak.
    const score = consistent * 100 + first;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

/** Minimal RFC4180-style split: honours double quotes and escaped "" pairs. */
function splitDelimitedLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out.map((c) => c.trim());
}

function parseDelimited(filename: string, buffer: Buffer, ext: string): RawParse {
  const text = stripBom(buffer.toString("utf8"));
  const { delimiter, label } = sniffDelimiter(text);

  // Hand the sniffed delimiter to the same parser used for workbooks so
  // quoting, embedded newlines and type coercion behave identically.
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(text, { type: "string", raw: false, FS: delimiter });
  } catch (err) {
    throw new UnsupportedFileError(
      `Could not read "${filename}" as ${label}-delimited text: ${(err as Error).message}`
    );
  }

  const sheetName = workbook.SheetNames[0];
  const table = sheetName ? readSheet(workbook, sheetName) : null;
  if (!table) {
    throw new UnsupportedFileError(
      `"${filename}" is ${label}-delimited text, but Atlas could not find a header row with data beneath it.`
    );
  }

  return {
    rows: table.rows,
    conversion: {
      sourceFormat: formatLabel(ext),
      detail:
        `Detected ${label}-delimited text and converted it to CSV.` +
        (table.headerRowIndex > 0
          ? ` ${table.headerRowIndex} title or note row${table.headerRowIndex === 1 ? "" : "s"} above the column headings ${table.headerRowIndex === 1 ? "was" : "were"} skipped.`
          : ""),
    },
  };
}

function parseWorkbook(filename: string, buffer: Buffer, ext: string): RawParse {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  } catch (err) {
    throw new UnsupportedFileError(
      `Could not parse "${filename}" as a spreadsheet: ${(err as Error).message}`
    );
  }

  if (workbook.SheetNames.length === 0) {
    throw new UnsupportedFileError(`"${filename}" has no sheets.`);
  }

  const tables = workbook.SheetNames.map((name) => readSheet(workbook, name)).filter(
    (t): t is SheetTable => t !== null
  );

  if (tables.length === 0) {
    throw new UnsupportedFileError(
      `"${filename}" has ${workbook.SheetNames.length} sheet${workbook.SheetNames.length === 1 ? "" : "s"}, ` +
        `but Atlas could not find a table in any of them — a header row with data beneath it.`
    );
  }

  // Sheets that share a header shape are the same table split up: one sheet
  // per brand, per site, per month. Reading only the first is how an
  // establishment quietly loses two thirds of its people, so they are stacked.
  // Sheets with a different shape are a different table, and are reported as
  // left out rather than forced together.
  const groups = new Map<string, SheetTable[]>();
  for (const table of tables) {
    const signature = table.headers.map((h) => h.trim().toLowerCase()).join("\u0000");
    groups.set(signature, [...(groups.get(signature) ?? []), table]);
  }

  const chosen = [...groups.values()].sort(
    (a, b) =>
      b.reduce((n, t) => n + t.rows.length, 0) - a.reduce((n, t) => n + t.rows.length, 0)
  )[0];

  const stacked = chosen.length > 1;
  const rows: Record<string, string>[] = [];
  for (const table of chosen) {
    for (const row of table.rows) {
      // Which sheet a row came from is often the only record of a real
      // distinction — a workbook split by brand may carry the brand nowhere
      // else. Added only when stacking, and never over an existing column.
      rows.push(stacked && !(SHEET_COLUMN in row) ? { [SHEET_COLUMN]: table.name, ...row } : row);
    }
  }

  const ignored = tables.filter((t) => !chosen.includes(t));
  const preamble = chosen.reduce((n, t) => n + t.headerRowIndex, 0);

  return {
    rows,
    conversion: {
      sourceFormat: formatLabel(ext),
      detail:
        (stacked
          ? `Stacked ${chosen.length} sheets that share the same columns — ${chosen
              .map((t) => `"${t.name}" (${t.rows.length})`)
              .join(", ")} — into one table of ${rows.length} rows.`
          : `Converted sheet "${chosen[0].name}" to CSV.`) +
        (preamble > 0
          ? ` ${preamble} title or note row${preamble === 1 ? "" : "s"} above the column headings ${preamble === 1 ? "was" : "were"} skipped.`
          : "") +
        (ignored.length > 0
          ? ` ${ignored.length} sheet${ignored.length === 1 ? "" : "s"} with different columns ${ignored.length === 1 ? "was" : "were"} left out: ${ignored
              .map((t) => `"${t.name}"`)
              .join(", ")}.`
          : ""),
    },
  };
}

/** Column naming which sheet a stacked row came from. */
const SHEET_COLUMN = "Source sheet";

interface SheetTable {
  name: string;
  headers: string[];
  rows: Record<string, string>[];
  /** How many rows sat above the header — a title band, a note, a blank. */
  headerRowIndex: number;
}

/**
 * Reads one sheet into a table, finding the header row rather than assuming
 * it is the first. Real exports open with a title, a "single source of truth"
 * note and a blank line as often as not, and taking row 1 as the header turns
 * every column into `__EMPTY_7` and the whole file into nothing.
 */
function readSheet(workbook: XLSX.WorkBook, name: string): SheetTable | null {
  const sheet = workbook.Sheets[name];
  if (!sheet) return null;

  const grid = XLSX.utils
    .sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false, blankrows: false })
    .map((row) => (row ?? []).map((cell) => String(cell ?? "").trim()));

  const headerRowIndex = findHeaderRow(grid);
  if (headerRowIndex === -1) return null;

  const headers = grid[headerRowIndex];
  const rows: Record<string, string>[] = [];

  for (const line of grid.slice(headerRowIndex + 1)) {
    const row: Record<string, string> = {};
    let filled = 0;

    headers.forEach((header, i) => {
      // A column with no heading has no name to join or map on. Its values
      // are unreachable either way, so it is dropped rather than presented
      // as a mystery column.
      if (!header) return;
      const value = line[i] ?? "";
      row[header] = value;
      if (value) filled++;
    });

    if (filled > 0) rows.push(row);
  }

  return rows.length === 0 ? null : { name, headers: headers.filter(Boolean), rows, headerRowIndex };
}

/** Cells that are plainly a figure rather than a column name. */
const NUMERIC_CELL = /^[-+$(]?[\d,.\s]+%?\)?$/;

/** How far into a sheet a header row is still plausibly a header row. */
const HEADER_SEARCH_ROWS = 25;

/**
 * Picks the row that names the columns. A header row is wide, its cells are
 * distinct words rather than figures, and it has data underneath it — which
 * is what separates it from the title band above it (wide but one cell) and
 * from the first data row (wide, but full of numbers and dates).
 *
 * Ties go to the earliest row, so a sheet whose header genuinely is row 1
 * behaves exactly as it always did.
 */
function findHeaderRow(grid: string[][]): number {
  let best = -1;
  let bestScore = 0;

  for (let i = 0; i < Math.min(grid.length, HEADER_SEARCH_ROWS); i++) {
    const filled = (grid[i] ?? []).filter(Boolean);
    if (filled.length < 2) continue;

    // A row with nothing but a couple of stray cells beneath it is a title
    // band, not a header — however wide it looks.
    const below = grid.slice(i + 1, i + 6).map((r) => r.filter(Boolean).length);
    if (below.length === 0 || Math.max(...below) < Math.ceil(filled.length / 2)) continue;

    const numeric = filled.filter((c) => NUMERIC_CELL.test(c)).length;
    const distinct = new Set(filled.map((c) => c.toLowerCase())).size;

    const score = filled.length + distinct - numeric * 3;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }

  return best;
}

/**
 * Accepts either a bare array of records or the common API-envelope shapes
 * ({ data: [...] }, { positions: [...] }, …). Nested objects are flattened
 * to dotted keys so `{"manager": {"id": "P001"}}` still reaches the column
 * mapper as a `manager.id` column.
 */
function parseJson(filename: string, buffer: Buffer): RawParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(buffer.toString("utf8")));
  } catch (err) {
    throw new UnsupportedFileError(`"${filename}" isn't valid JSON: ${(err as Error).message}`);
  }

  let records: unknown[] | null = null;
  let envelope = "";

  if (Array.isArray(parsed)) {
    records = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const arrayKey = Object.keys(obj).find((k) => Array.isArray(obj[k]));
    if (arrayKey) {
      records = obj[arrayKey] as unknown[];
      envelope = ` from the "${arrayKey}" array`;
    }
  }

  if (!records) {
    throw new UnsupportedFileError(
      `"${filename}" is valid JSON but contains no array of records. Atlas expects a list of positions, ` +
        `either at the top level or under a key such as "data" or "positions".`
    );
  }

  const rows = records
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object" && !Array.isArray(r))
    .map((r) => flattenRecord(r));

  if (rows.length === 0) {
    throw new UnsupportedFileError(`"${filename}" contains an array, but no object records inside it.`);
  }

  return {
    rows,
    conversion: {
      sourceFormat: "JSON",
      detail: `Flattened ${rows.length} JSON record${rows.length === 1 ? "" : "s"}${envelope} into CSV columns.`,
    },
  };
}

function flattenRecord(record: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) {
      out[path] = "";
    } else if (Array.isArray(value)) {
      out[path] = value.map((v) => (v == null ? "" : String(v))).join("; ");
    } else if (typeof value === "object") {
      Object.assign(out, flattenRecord(value as Record<string, unknown>, path));
    } else {
      out[path] = String(value);
    }
  }
  return out;
}

/**
 * Handles the flat "record element repeated under a wrapper" shape HR
 * systems emit, treating both child elements and attributes as columns.
 * Deliberately not a general XML mapper — anything deeper fails loudly.
 */
function parseXml(filename: string, buffer: Buffer): RawParse {
  const text = stripBom(buffer.toString("utf8"));

  // The repeated element is whichever tag appears most often with children —
  // <Position>, <Employee>, <row>, whatever the vendor happened to call it.
  const tagCounts = new Map<string, number>();
  for (const match of text.matchAll(/<([A-Za-z_][\w.-]*)(\s[^>]*)?>/g)) {
    const tag = match[1];
    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  let recordTag: string | null = null;
  let bestCount = 1;
  for (const [tag, count] of tagCounts) {
    if (count > bestCount) {
      bestCount = count;
      recordTag = tag;
    }
  }

  if (!recordTag) {
    throw new UnsupportedFileError(
      `"${filename}" has no repeated record element Atlas could read as rows.`
    );
  }

  const blockRe = new RegExp(`<${recordTag}(\\s[^>]*)?>([\\s\\S]*?)</${recordTag}>`, "g");
  const rows: Record<string, string>[] = [];

  for (const block of text.matchAll(blockRe)) {
    const row: Record<string, string> = {};

    for (const attr of (block[1] ?? "").matchAll(/([A-Za-z_][\w.-]*)\s*=\s*"([^"]*)"/g)) {
      row[attr[1]] = decodeEntities(attr[2]);
    }
    for (const field of block[2].matchAll(/<([A-Za-z_][\w.-]*)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)) {
      row[field[1]] = decodeEntities(field[2].trim());
    }

    if (Object.keys(row).length > 0) rows.push(row);
  }

  if (rows.length === 0) {
    throw new UnsupportedFileError(
      `Found <${recordTag}> elements in "${filename}" but couldn't read any fields from them.`
    );
  }

  return {
    rows,
    conversion: {
      sourceFormat: "XML",
      detail: `Read ${rows.length} <${recordTag}> element${rows.length === 1 ? "" : "s"} and converted them to CSV columns.`,
    },
  };
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function formatLabel(ext: string): string {
  return formatFor(ext)?.label ?? ext;
}

/** Round-trips a normalised table back to CSV text for download / audit. */
export function toCsv(headers: string[], rows: Record<string, string>[]): string {
  const escape = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [
    headers.map(escape).join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h] ?? "")).join(",")),
  ].join("\n");
}
