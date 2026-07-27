import { inflateRawSync } from "node:zlib";
import { UnsupportedFileError, type ParsedFile } from "./parseFile";

/**
 * Reads the tables out of a Word document. Org data arrives as a .docx more
 * often than anyone would like — a structure appendix in a board paper, a
 * restructure proposal, a service review — and refusing it sends the client
 * away to re-export something they may not have access to.
 *
 * Only real tables are read. Paragraph text is deliberately ignored: inferring
 * an establishment from prose is guesswork, and a wrong establishment that
 * looks right is worse than a refusal. A .docx with no table says so.
 *
 * A .docx is a ZIP, and there is no zip dependency in this project (nor one in
 * Node's standard library), so the archive is walked directly. That is a
 * smaller cost than a dependency for one file format.
 */

const DOCUMENT_ENTRY = "word/document.xml";

export function parseDocxFile(filename: string, buffer: Buffer): ParsedFile {
  const xml = readZipEntry(buffer, DOCUMENT_ENTRY, filename);
  const tables = extractTables(xml);

  if (tables.length === 0) {
    throw new UnsupportedFileError(
      `"${filename}" is a Word document with no tables in it. Atlas reads establishment data from Word tables only — ` +
        `it will not try to infer an org structure from paragraphs, because a wrong structure that looks right is worse than none. ` +
        `Paste the data into a table, or export it as CSV.`
    );
  }

  // The largest table is the establishment; the small ones are document
  // furniture (a version history, a distribution list, a sign-off block).
  const sorted = [...tables].sort((a, b) => b.length - a.length);
  const table = sorted[0];
  const ignored = tables.length - 1;

  if (table.length < 2) {
    throw new UnsupportedFileError(
      `The largest table in "${filename}" has only a header row — there is no data below it to ingest.`
    );
  }

  const headers = dedupeHeaders(table[0]);
  const rows = table.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] ?? "").trim();
    });
    return row;
  });

  return {
    headers,
    rows,
    conversion: {
      sourceFormat: "Word",
      detail:
        `Read the largest table in the document (${rows.length} row${rows.length === 1 ? "" : "s"} × ${headers.length} column${headers.length === 1 ? "" : "s"}) and converted it to CSV.` +
        (ignored > 0
          ? ` ${ignored} smaller table${ignored === 1 ? "" : "s"} in the document ${ignored === 1 ? "was" : "were"} ignored.`
          : ""),
      rowCount: rows.length,
    },
  };
}

/** Blank or repeated header cells would collide and silently drop a column. */
function dedupeHeaders(cells: string[]): string[] {
  const out: string[] = [];
  cells.forEach((cell, i) => {
    const base = cell.trim() || `Column ${i + 1}`;
    let name = base;
    let n = 2;
    while (out.includes(name)) name = `${base} (${n++})`;
    out.push(name);
  });
  return out;
}

/** Rows of cells for every <w:tbl> in the document, in document order. */
function extractTables(xml: string): string[][][] {
  const tables: string[][][] = [];

  for (const table of xml.matchAll(/<w:tbl(?:\s[^>]*)?>([\s\S]*?)<\/w:tbl>/g)) {
    const rows: string[][] = [];

    for (const row of table[1].matchAll(/<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g)) {
      const cells: string[] = [];
      for (const cell of row[1].matchAll(/<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g)) {
        cells.push(cellText(cell[1]));
      }
      if (cells.length > 0) rows.push(cells);
    }

    // A single-column "table" is a layout device, not data.
    if (rows.length > 0 && Math.max(...rows.map((r) => r.length)) > 1) tables.push(rows);
  }

  return tables;
}

/**
 * Word splits a single word across several <w:t> runs whenever formatting
 * changes mid-cell, so the runs are concatenated rather than joined — but a
 * paragraph break inside a cell is a real space.
 */
function cellText(cellXml: string): string {
  return cellXml
    .split(/<\/w:p>/)
    .map((paragraph) =>
      [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
        .map((m) => decodeEntities(m[1]))
        .join("")
    )
    .filter((p) => p.trim() !== "")
    .join(" ")
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Pulls one entry out of a ZIP archive via its central directory (the only
 * authoritative index — scanning for local headers misreads archives with
 * data descriptors). Handles the two compression methods Word actually
 * emits: stored and deflate.
 */
function readZipEntry(buffer: Buffer, entryName: string, filename: string): string {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd === -1) {
    throw new UnsupportedFileError(
      `"${filename}" is not a readable Word document — it does not look like a .docx archive at all. ` +
        `A legacy .doc has to be saved as .docx first.`
    );
  }

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    if (name === entryName) {
      // The local header's own name/extra lengths differ from the central
      // directory's, so they must be re-read here rather than reused.
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const data = buffer.subarray(start, start + compressedSize);

      try {
        return (method === 0 ? data : inflateRawSync(data)).toString("utf8");
      } catch (err) {
        throw new UnsupportedFileError(
          `Could not decompress "${filename}": ${(err as Error).message}`
        );
      }
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  throw new UnsupportedFileError(
    `"${filename}" is a ZIP archive but has no ${entryName} inside it, so it is not a Word document.`
  );
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  // The record is at the very end unless there is a trailing comment, which
  // is capped at 64KB — so this is a bounded scan, not a full-file search.
  const floor = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= floor; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}
