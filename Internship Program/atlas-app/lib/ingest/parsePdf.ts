import { inflateSync } from "node:zlib";
import type { ParsedFile } from "./parseFile";

/**
 * Reads a table out of a PDF's own text layer — no model, no API key, and no
 * guessing.
 *
 * Most PDFs that carry establishment data were exported from something that
 * already had the data as text: Word, Excel, a board-pack generator, an HR
 * system's report writer. That text is still in the file, along with the
 * coordinates it was drawn at, so the table can be reconstructed by grouping
 * runs into rows by their y position and columns by their x position. That is
 * arithmetic, not inference, which is why it is allowed to produce a baseline.
 *
 * What this deliberately will *not* do is reconstruct a drawn org chart —
 * boxes joined by connector lines — from its geometry. Deciding who reports
 * to whom by measuring which line touches which box is exactly the kind of
 * plausible-but-wrong import the house rule warns about, and a wrong
 * structure that looks right is worse than no structure. A PDF with no
 * readable table raises PdfNoTableError, and the caller decides whether to
 * hand it to the vision reader instead.
 */

/** Raised when the PDF holds no table the text layer can prove. */
export class PdfNoTableError extends Error {}

interface TextRun {
  x: number;
  y: number;
  text: string;
}

/** y values within this many units are the same row; x within this, the same column. */
const ROW_TOLERANCE = 3;
const COLUMN_TOLERANCE = 12;

export function parsePdfFile(filename: string, buffer: Buffer): ParsedFile {
  const runs = extractTextRuns(buffer);

  if (runs.length === 0) {
    throw new PdfNoTableError(
      `"${filename}" has no text layer — it is a scan or an exported picture, so there are no characters in it to read.`
    );
  }

  const lines = groupIntoLines(runs);
  const table = toTable(lines);

  if (!table) {
    throw new PdfNoTableError(
      `"${filename}" has text in it, but not laid out as a table with consistent columns — it is most likely a drawn org chart or a narrative document.`
    );
  }

  const { headers, rows } = table;

  return {
    headers,
    rows,
    conversion: {
      sourceFormat: "PDF",
      detail:
        `Read the PDF's own text layer and reconstructed a table from it by position: ` +
        `${rows.length} row${rows.length === 1 ? "" : "s"} × ${headers.length} column${headers.length === 1 ? "" : "s"}. ` +
        `No model was involved — the characters and their coordinates were already in the file.`,
      rowCount: rows.length,
    },
  };
}

// --- PDF object plumbing --------------------------------------------------

/**
 * Latin-1 maps every byte to exactly one character, so the file can be
 * searched as a string without corrupting the binary stream payloads.
 */
function asBinaryString(buffer: Buffer): string {
  return buffer.toString("latin1");
}

interface PdfObject {
  num: number;
  dict: string;
  stream: Buffer | null;
}

function readObjects(raw: string): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();
  const objectRe = /(\d+)\s+(\d+)\s+obj\b/g;

  for (let m = objectRe.exec(raw); m; m = objectRe.exec(raw)) {
    const num = Number(m[1]);
    const bodyStart = m.index + m[0].length;
    const end = raw.indexOf("endobj", bodyStart);
    if (end === -1) continue;

    const body = raw.slice(bodyStart, end);
    const streamAt = body.indexOf("stream");
    const dict = streamAt === -1 ? body : body.slice(0, streamAt);

    let stream: Buffer | null = null;
    if (streamAt !== -1) {
      // The spec allows \r\n or \n after the keyword, and nothing else.
      let dataStart = streamAt + "stream".length;
      if (body[dataStart] === "\r") dataStart++;
      if (body[dataStart] === "\n") dataStart++;
      const dataEnd = body.lastIndexOf("endstream");
      if (dataEnd > dataStart) {
        const bytes = Buffer.from(body.slice(dataStart, dataEnd), "latin1");
        stream = /\/FlateDecode/.test(dict) ? tryInflate(bytes) : bytes;
      }
    }

    objects.set(num, { num, dict, stream });
  }

  return objects;
}

function tryInflate(bytes: Buffer): Buffer | null {
  try {
    return inflateSync(bytes);
  } catch {
    // A stream this reader can't decompress (an unsupported filter chain, an
    // encrypted document) is skipped rather than fatal — another stream in
    // the same file may still carry the table.
    return null;
  }
}

// --- ToUnicode ------------------------------------------------------------

type CMap = Map<number, string>;

/**
 * Subset fonts encode text as glyph ids, which are meaningless without the
 * font's own ToUnicode map. Without this, a perfectly readable PDF extracts
 * as mojibake — and mojibake that still forms a table is precisely the
 * plausible-but-wrong import worth avoiding.
 */
function parseCMap(text: string): CMap {
  const map: CMap = new Map();

  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(pair[1], 16), hexToString(pair[2]));
    }
  }

  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    // Ranges come in two shapes: a start value, or an array of destinations.
    for (const entry of block[1].matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g
    )) {
      const from = parseInt(entry[1], 16);
      const to = parseInt(entry[2], 16);

      if (entry[3]) {
        const base = parseInt(entry[3], 16);
        for (let code = from; code <= to && code - from < 65536; code++) {
          map.set(code, String.fromCodePoint(base + (code - from)));
        }
      } else if (entry[4]) {
        const items = [...entry[4].matchAll(/<([0-9A-Fa-f]+)>/g)];
        items.forEach((item, i) => map.set(from + i, hexToString(item[1])));
      }
    }
  }

  return map;
}

function hexToString(hex: string): string {
  let out = "";
  for (let i = 0; i + 3 < hex.length + 1; i += 4) {
    const code = parseInt(hex.slice(i, i + 4), 16);
    if (Number.isFinite(code) && code !== 0) out += String.fromCodePoint(code);
  }
  return out;
}

/** Resource name (e.g. "F1") to the ToUnicode map of the font it refers to. */
function buildFontMaps(objects: Map<number, PdfObject>): Map<string, CMap> {
  const cmapByObject = new Map<number, CMap>();
  for (const obj of objects.values()) {
    if (!obj.stream) continue;
    const text = obj.stream.toString("latin1");
    if (text.includes("beginbfchar") || text.includes("beginbfrange")) {
      cmapByObject.set(obj.num, parseCMap(text));
    }
  }
  if (cmapByObject.size === 0) return new Map();

  const toUnicodeOf = new Map<number, number>();
  for (const obj of objects.values()) {
    const ref = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(obj.dict);
    if (ref) toUnicodeOf.set(obj.num, Number(ref[1]));
  }

  const byName = new Map<string, CMap>();
  for (const obj of objects.values()) {
    const fontDict = /\/Font\s*<<([\s\S]*?)>>/.exec(obj.dict);
    if (!fontDict) continue;
    for (const entry of fontDict[1].matchAll(/\/([A-Za-z0-9#+.\-]+)\s+(\d+)\s+\d+\s+R/g)) {
      const cmapObj = toUnicodeOf.get(Number(entry[2]));
      const cmap = cmapObj !== undefined ? cmapByObject.get(cmapObj) : undefined;
      if (cmap) byName.set(entry[1], cmap);
    }
  }

  // A single-font document needs no resolution at all, and resolution is the
  // part most likely to miss, so fall back to the one map that exists.
  if (byName.size === 0 && cmapByObject.size === 1) {
    byName.set("*", [...cmapByObject.values()][0]);
  }

  return byName;
}

// --- content stream text extraction ---------------------------------------

function extractTextRuns(buffer: Buffer): TextRun[] {
  const raw = asBinaryString(buffer);
  const objects = readObjects(raw);
  const fonts = buildFontMaps(objects);
  const runs: TextRun[] = [];

  // Pages are stacked vertically so that runs from page 2 sort below page 1
  // and the table reads in document order rather than interleaving.
  let pageOffset = 0;

  for (const obj of objects.values()) {
    if (!obj.stream) continue;
    const content = obj.stream.toString("latin1");
    if (!content.includes("BT") || !(content.includes("Tj") || content.includes("TJ"))) continue;

    const pageRuns = readContentStream(content, fonts);
    if (pageRuns.length === 0) continue;

    const top = Math.max(...pageRuns.map((r) => r.y));
    for (const run of pageRuns) runs.push({ ...run, y: run.y - pageOffset });
    pageOffset += top + 1000;
  }

  return runs;
}

function readContentStream(content: string, fonts: Map<string, CMap>): TextRun[] {
  const runs: TextRun[] = [];

  let x = 0;
  let y = 0;
  let lineX = 0;
  let lineY = 0;
  let leading = 12;
  let cmap: CMap | undefined = fonts.get("*");

  // One pass over the operators. Text-space scaling is ignored on purpose:
  // rows and columns are found by clustering relative positions, and absolute
  // units never matter.
  const tokenRe =
    /\/([A-Za-z0-9#+.\-]+)\s+[\d.\-]+\s+Tf|([\d.\-]+)\s+([\d.\-]+)\s+(?:Td|TD)|([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+Tm|(T\*)|\[((?:[^\][\\]|\\.)*)\]\s*TJ|(\((?:[^()\\]|\\.)*\))\s*(?:Tj|')|(<[0-9A-Fa-f\s]*>)\s*(?:Tj|')|([\d.\-]+)\s+TL|(BT)/g;

  for (let m = tokenRe.exec(content); m; m = tokenRe.exec(content)) {
    if (m[1] !== undefined) {
      cmap = fonts.get(m[1]) ?? fonts.get("*");
    } else if (m[2] !== undefined) {
      lineX += Number(m[2]);
      lineY += Number(m[3]);
      x = lineX;
      y = lineY;
    } else if (m[4] !== undefined) {
      lineX = Number(m[8]);
      lineY = Number(m[9]);
      x = lineX;
      y = lineY;
    } else if (m[10] !== undefined) {
      lineY -= leading;
      x = lineX;
      y = lineY;
    } else if (m[11] !== undefined) {
      const text = decodeTJ(m[11], cmap);
      if (text.trim()) runs.push({ x, y, text });
    } else if (m[12] !== undefined) {
      const text = decodeLiteral(m[12].slice(1, -1), cmap);
      if (text.trim()) runs.push({ x, y, text });
    } else if (m[13] !== undefined) {
      const text = decodeHex(m[13].slice(1, -1), cmap);
      if (text.trim()) runs.push({ x, y, text });
    } else if (m[14] !== undefined) {
      leading = Number(m[14]);
    } else if (m[15] !== undefined) {
      x = 0;
      y = 0;
      lineX = 0;
      lineY = 0;
    }
  }

  return runs;
}

/**
 * A TJ array interleaves strings with kerning numbers. A large negative
 * number is the writer's way of drawing a space, so it is treated as one —
 * without this, "Chief Executive" arrives as "ChiefExecutive".
 */
function decodeTJ(body: string, cmap: CMap | undefined): string {
  let out = "";
  const partRe = /\((?:[^()\\]|\\.)*\)|<[0-9A-Fa-f\s]*>|-?[\d.]+/g;

  for (let m = partRe.exec(body); m; m = partRe.exec(body)) {
    const token = m[0];
    if (token.startsWith("(")) out += decodeLiteral(token.slice(1, -1), cmap);
    else if (token.startsWith("<")) out += decodeHex(token.slice(1, -1), cmap);
    else if (Number(token) < -120 && !out.endsWith(" ")) out += " ";
  }

  return out;
}

function decodeLiteral(body: string, cmap: CMap | undefined): string {
  let out = "";

  for (let i = 0; i < body.length; i++) {
    let ch = body[i];

    if (ch === "\\") {
      const next = body[++i];
      const escapes: Record<string, string> = {
        n: "\n",
        r: "\r",
        t: "\t",
        b: "\b",
        f: "\f",
        "(": "(",
        ")": ")",
        "\\": "\\",
      };
      if (next in escapes) {
        ch = escapes[next];
      } else if (next >= "0" && next <= "7") {
        let octal = next;
        while (octal.length < 3 && body[i + 1] >= "0" && body[i + 1] <= "7") octal += body[++i];
        ch = String.fromCharCode(parseInt(octal, 8));
      } else {
        ch = next ?? "";
      }
    }

    out += cmap ? (cmap.get(ch.charCodeAt(0)) ?? ch) : ch;
  }

  return out;
}

function decodeHex(body: string, cmap: CMap | undefined): string {
  const hex = body.replace(/\s+/g, "");
  let out = "";

  for (let i = 0; i + 1 < hex.length; i += 4) {
    const code = parseInt(hex.slice(i, i + 4), 16);
    if (!Number.isFinite(code)) continue;
    out += cmap?.get(code) ?? String.fromCodePoint(code);
  }

  return out;
}

// --- turning positioned text into a table ---------------------------------

function groupIntoLines(runs: TextRun[]): TextRun[][] {
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextRun[][] = [];
  let current: TextRun[] = [];
  let currentY: number | null = null;

  for (const run of sorted) {
    if (currentY === null || Math.abs(run.y - currentY) <= ROW_TOLERANCE) {
      current.push(run);
      currentY = currentY ?? run.y;
    } else {
      lines.push(current);
      current = [run];
      currentY = run.y;
    }
  }
  if (current.length > 0) lines.push(current);

  return lines.map((line) => mergeAdjacent(line.sort((a, b) => a.x - b.x)));
}

/** Runs drawn side by side are one cell split by a font change, not two cells. */
function mergeAdjacent(line: TextRun[]): TextRun[] {
  const out: TextRun[] = [];

  for (const run of line) {
    const previous = out[out.length - 1];
    if (previous && run.x - previous.x < COLUMN_TOLERANCE) {
      previous.text += run.text;
    } else {
      out.push({ ...run });
    }
  }

  return out.map((r) => ({ ...r, text: r.text.replace(/\s+/g, " ").trim() }));
}

/**
 * Columns are the x positions that recur down the page. Requiring a position
 * to appear on most lines is what separates a table from a paragraph that
 * happens to have two words on a line.
 */
function toTable(lines: TextRun[][]): { headers: string[]; rows: Record<string, string>[] } | null {
  const candidates = lines.filter((l) => l.length >= 2);
  if (candidates.length < 2) return null;

  const anchors: number[] = [];
  const hits: number[] = [];

  for (const line of candidates) {
    for (const run of line) {
      const at = anchors.findIndex((a) => Math.abs(a - run.x) <= COLUMN_TOLERANCE);
      if (at === -1) {
        anchors.push(run.x);
        hits.push(1);
      } else {
        hits[at]++;
      }
    }
  }

  const minimumHits = Math.max(2, Math.floor(candidates.length * 0.5));
  const columns = anchors
    .map((x, i) => ({ x, hits: hits[i] }))
    .filter((c) => c.hits >= minimumHits)
    .sort((a, b) => a.x - b.x)
    .map((c) => c.x);

  if (columns.length < 2) return null;

  const grid = candidates
    .map((line) => {
      const cells = new Array<string>(columns.length).fill("");
      let filled = 0;

      for (const run of line) {
        let best = 0;
        for (let i = 1; i < columns.length; i++) {
          if (Math.abs(columns[i] - run.x) < Math.abs(columns[best] - run.x)) best = i;
        }
        // A run nowhere near any column is page furniture — a footer, a page
        // number — and is dropped rather than forced into a cell.
        if (Math.abs(columns[best] - run.x) > COLUMN_TOLERANCE * 3) continue;
        cells[best] = cells[best] ? `${cells[best]} ${run.text}` : run.text;
        filled++;
      }

      return { cells, filled };
    })
    .filter((row) => row.filled >= 2);

  if (grid.length < 2) return null;

  const headerRow = grid[0].cells;
  const headers = headerRow.map((cell, i) => cell.trim() || `Column ${i + 1}`);
  const seen = new Set<string>();
  const unique = headers.map((h) => {
    let name = h;
    let n = 2;
    while (seen.has(name)) name = `${h} (${n++})`;
    seen.add(name);
    return name;
  });

  const rows = grid.slice(1).map((row) => {
    const record: Record<string, string> = {};
    unique.forEach((h, i) => {
      record[h] = row.cells[i] ?? "";
    });
    return record;
  });

  return { headers: unique, rows };
}

/** Lets the router tell "this file is broken" from "there is no table in it". */
export function isPdfNoTable(err: unknown): err is PdfNoTableError {
  return err instanceof PdfNoTableError;
}
