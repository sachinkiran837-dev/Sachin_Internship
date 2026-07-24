import * as XLSX from "xlsx";

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
}

const SUPPORTED_EXTENSIONS = [".csv", ".xlsx", ".xls"];

export class UnsupportedFileError extends Error {}

/**
 * Parses a CSV or XLSX buffer into headers + rows. Fails clearly on an
 * unsupported shape rather than silently importing a partial result — an
 * empty sheet, no header row, or an extension we don't recognise all throw.
 */
export function parseEstablishmentFile(filename: string, buffer: Buffer): ParsedFile {
  const lower = filename.toLowerCase();
  if (!SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    throw new UnsupportedFileError(
      `Unsupported file type for "${filename}". Expected one of: ${SUPPORTED_EXTENSIONS.join(", ")}.`
    );
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch (err) {
    throw new UnsupportedFileError(
      `Could not parse "${filename}" as a spreadsheet: ${(err as Error).message}`
    );
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new UnsupportedFileError(`"${filename}" has no sheets.`);
  }

  const sheet = workbook.Sheets[sheetName];
  const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false,
  });

  if (rows.length === 0) {
    throw new UnsupportedFileError(
      `"${filename}" has no data rows below the header row.`
    );
  }

  const headers = Object.keys(rows[0]);
  if (headers.length === 0) {
    throw new UnsupportedFileError(`"${filename}" has no recognisable header row.`);
  }

  return { headers, rows };
}
