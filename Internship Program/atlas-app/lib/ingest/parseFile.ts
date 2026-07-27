import * as XLSX from "xlsx";

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
  /** How the source was recognised and normalised — surfaced in the UI, never silent. */
  conversion: ConversionReport;
}

export interface ConversionReport {
  sourceFormat: string;
  detail: string;
  rowCount: number;
}

export class UnsupportedFileError extends Error {}

/**
 * Everything Atlas can normalise into the one tabular shape the rest of the
 * pipeline reads. Ordered by how they're detected, not alphabetically.
 */
export const SUPPORTED_FORMATS = [
  { ext: ".csv", label: "CSV" },
  { ext: ".tsv", label: "Tab-separated" },
  { ext: ".txt", label: "Delimited text" },
  { ext: ".psv", label: "Pipe-separated" },
  { ext: ".xlsx", label: "Excel" },
  { ext: ".xlsm", label: "Excel (macro)" },
  { ext: ".xls", label: "Excel (legacy)" },
  { ext: ".ods", label: "OpenDocument" },
  { ext: ".json", label: "JSON" },
  { ext: ".xml", label: "XML" },
  { ext: ".html", label: "HTML table" },
  { ext: ".htm", label: "HTML table" },
] as const;

// Everything not listed here (.xlsx/.xlsm/.xls/.ods/.html/.htm) is handed to
// the workbook reader, which is the correct fallback for any spreadsheet
// format the xlsx library recognises.
const DELIMITED_EXTENSIONS: string[] = [".csv", ".tsv", ".txt", ".psv"];

/**
 * Parses any supported establishment export into headers + rows — the CSV
 * shape the column mapper and graph builder expect. Every branch either
 * produces a real table or throws: an empty sheet, a header-only file, a
 * JSON blob with no array of records, or an unrecognised extension all
 * fail loudly rather than importing a partial result.
 */
export function parseEstablishmentFile(filename: string, buffer: Buffer): ParsedFile {
  const lower = filename.toLowerCase();
  const ext = SUPPORTED_FORMATS.map((f) => f.ext).find((e) => lower.endsWith(e));

  if (!ext) {
    throw new UnsupportedFileError(
      `Atlas can't read "${filename}". Supported formats: ${SUPPORTED_FORMATS.map((f) => f.ext).join(", ")}. ` +
        `Export the establishment from your HR system as CSV or Excel and try again.`
    );
  }

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

  const rows = sheetRows(workbook, filename);
  return {
    rows,
    conversion: {
      sourceFormat: formatLabel(ext),
      detail: `Detected ${label}-delimited text and converted it to CSV.`,
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

  const rows = sheetRows(workbook, filename);
  const sheetName = workbook.SheetNames[0];
  const extraSheets = workbook.SheetNames.length - 1;

  return {
    rows,
    conversion: {
      sourceFormat: formatLabel(ext),
      detail:
        `Converted sheet "${sheetName}" to CSV.` +
        (extraSheets > 0
          ? ` ${extraSheets} other sheet${extraSheets === 1 ? "" : "s"} in the file ${extraSheets === 1 ? "was" : "were"} ignored.`
          : ""),
    },
  };
}

function sheetRows(workbook: XLSX.WorkBook, filename: string): Record<string, string>[] {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new UnsupportedFileError(`"${filename}" has no sheets.`);
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
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
  return SUPPORTED_FORMATS.find((f) => f.ext === ext)?.label ?? ext;
}

/** Round-trips a normalised table back to CSV text for download / audit. */
export function toCsv(headers: string[], rows: Record<string, string>[]): string {
  const escape = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [
    headers.map(escape).join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h] ?? "")).join(",")),
  ].join("\n");
}
