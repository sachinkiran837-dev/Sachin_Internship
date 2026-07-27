/**
 * Verifies the deterministic PDF reader — the path that reads an
 * establishment out of a PDF's own text layer with no API key and no model.
 *
 * Fixtures are real PDFs written here rather than checked in, so the test
 * can't drift from what the reader claims to handle. Both encodings that
 * matter in the wild are covered: plain literal strings (what Word and Excel
 * emit for a standard font) and hex-encoded glyph ids with a ToUnicode map
 * (what a subset-embedded font emits, and what extracts as mojibake if the
 * CMap is ignored).
 *
 * Run with `npx tsx scripts/verify-pdf.ts` — no database needed.
 */
import { deflateSync } from "node:zlib";

import { parsePdfFile, PdfNoTableError } from "../lib/ingest/parsePdf";
import { mapColumns } from "../lib/ingest/columnMapper";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

// --- a minimal but genuine PDF writer -------------------------------------

interface PdfOptions {
  /** Encode text as hex glyph ids behind a ToUnicode map, as a subset font does. */
  subsetFont?: boolean;
}

function buildPdf(rows: string[][], columnX: number[], opts: PdfOptions = {}): Buffer {
  const cmapEntries: string[] = [];
  const glyphOf = new Map<string, number>();

  const encode = (text: string): string => {
    if (!opts.subsetFont) {
      const escaped = text.replace(/([()\\])/g, "\\$1");
      return `(${escaped}) Tj`;
    }
    let hex = "";
    for (const ch of text) {
      if (!glyphOf.has(ch)) {
        const id = glyphOf.size + 3; // arbitrary, as a real subset would be
        glyphOf.set(ch, id);
        cmapEntries.push(
          `<${id.toString(16).padStart(4, "0")}> <${ch.codePointAt(0)!.toString(16).padStart(4, "0")}>`
        );
      }
      hex += glyphOf.get(ch)!.toString(16).padStart(4, "0");
    }
    return `<${hex}> Tj`;
  };

  const lines: string[] = ["BT", "/F1 11 Tf"];
  rows.forEach((cells, rowIndex) => {
    const y = 760 - rowIndex * 18;
    cells.forEach((cell, colIndex) => {
      if (!cell) return;
      lines.push(`1 0 0 1 ${columnX[colIndex]} ${y} Tm`, encode(cell));
    });
  });
  lines.push("ET");

  const content = deflateSync(Buffer.from(lines.join("\n"), "latin1"));
  const toUnicode = deflateSync(
    Buffer.from(
      `/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n` +
        `${cmapEntries.length} beginbfchar\n${cmapEntries.join("\n")}\nendbfchar\n` +
        `endcmap CMapName currentdict /CMap defineresource pop end end`,
      "latin1"
    )
  );

  const objects: string[] = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n${content.toString("latin1")}\nendstream\nendobj\n`,
    opts.subsetFont
      ? `5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /AAAAAA+Helvetica /Encoding /Identity-H /ToUnicode 6 0 R >>\nendobj\n`
      : `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`,
    `6 0 obj\n<< /Length ${toUnicode.length} /Filter /FlateDecode >>\nstream\n${toUnicode.toString("latin1")}\nendstream\nendobj\n`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }

  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}

const TABLE = [
  ["Position ID", "Employee Name", "Position Title", "Department", "Manager ID", "Fully Loaded Cost"],
  ["P100", "Dana Whitfield", "Chief Executive", "Executive", "", "410000"],
  ["P101", "Ravi Anand", "Director of Operations", "Operations", "P100", "265000"],
  ["P102", "Mei Lin", "Operations Manager", "Operations", "P101", "175000"],
  ["P103", "Tom Beckett", "Operations Manager", "Operations", "P101", "172000"],
  ["P104", "Sara Cole", "Service Coordinator", "Operations", "P102", "98000"],
  ["P105", "Jonah Reed", "Service Coordinator", "Operations", "P103", "96500"],
];
const COLUMN_X = [40, 110, 230, 370, 470, 530];

function check(label: string, pdf: Buffer) {
  const parsed = parsePdfFile("establishment.pdf", pdf);

  console.log(`${label}`);
  console.log(`   ${parsed.conversion.detail}`);
  console.log(`   headers: ${parsed.headers.join(" | ")}`);

  assert(
    parsed.headers.length === TABLE[0].length,
    `expected ${TABLE[0].length} columns, got ${parsed.headers.length}: ${parsed.headers}`
  );
  assert(
    parsed.rows.length === TABLE.length - 1,
    `expected ${TABLE.length - 1} data rows, got ${parsed.rows.length}`
  );
  assert(
    parsed.headers[0] === "Position ID" && parsed.headers[2] === "Position Title",
    `headers were not read cleanly: ${parsed.headers}`
  );

  // Values with spaces in them are the ones a naive extractor mangles.
  const first = parsed.rows[0];
  assert(
    first["Employee Name"] === "Dana Whitfield",
    `name run was mangled: "${first["Employee Name"]}"`
  );
  assert(
    parsed.rows[1]["Position Title"] === "Director of Operations",
    `multi-word title was mangled: "${parsed.rows[1]["Position Title"]}"`
  );
  assert(first["Fully Loaded Cost"] === "410000", `cost was misread: "${first["Fully Loaded Cost"]}"`);

  // The whole point is that the result reaches the rest of the pipeline, so
  // the columns have to map like any other source's would.
  const mapped = mapColumns(parsed.headers).filter((m) => m.targetField);
  assert(
    mapped.length === 6,
    `expected all six columns to map to canonical fields, got ${mapped.map((m) => m.targetField)}`
  );
  console.log(`   mapped to: ${mapped.map((m) => m.targetField).join(", ")}\n`);
}

function main() {
  // --- 1. the ordinary case: a standard font, literal strings -----------
  check("1. Word/Excel-style PDF (WinAnsi, literal strings)", buildPdf(TABLE, COLUMN_X));

  // --- 2. a subset font: hex glyph ids behind a ToUnicode map -----------
  check(
    "2. Subset-embedded font (Identity-H hex, ToUnicode CMap)",
    buildPdf(TABLE, COLUMN_X, { subsetFont: true })
  );

  // --- 3. prose is not a table, and must not be forced into one ---------
  const prose = buildPdf(
    [
      ["The board reviewed the structure of the operations directorate."],
      ["It was agreed that a further review would follow in the spring."],
      ["No decisions on individual roles were taken at this meeting."],
    ],
    [40]
  );
  let refused: unknown = null;
  try {
    parsePdfFile("board-minutes.pdf", prose);
  } catch (err) {
    refused = err;
  }
  assert(refused instanceof PdfNoTableError, "a prose PDF must not be read as a table");
  console.log(`3. Prose PDF → refused: ${(refused as Error).message.slice(0, 96)}…`);

  // --- 4. no text layer at all (a scan) --------------------------------
  const scan = Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF",
    "latin1"
  );
  let scanErr: unknown = null;
  try {
    parsePdfFile("scanned-chart.pdf", scan);
  } catch (err) {
    scanErr = err;
  }
  assert(scanErr instanceof PdfNoTableError, "a PDF with no text must raise PdfNoTableError");
  assert(
    (scanErr as Error).message.includes("no text layer"),
    `the reason must distinguish a scan from a chart: ${(scanErr as Error).message}`
  );
  console.log(`4. Scanned PDF → refused: ${(scanErr as Error).message.slice(0, 96)}…`);

  return buildPdf(TABLE, COLUMN_X, { subsetFont: true });
}

/** The point of all of the above: a PDF becomes a working establishment. */
async function endToEnd(pdf: Buffer) {
  const { readSourceFile } = await import("../lib/ingest/readSource");
  const { bindFiles } = await import("../lib/ingest/bindFiles");
  const { buildOrgGraph } = await import("../lib/ingest/buildGraph");
  const { computeMetrics } = await import("../lib/metrics/diagnostics");

  const parsed = await readSourceFile("establishment.pdf", pdf);
  const bound = bindFiles([{ filename: "establishment.pdf", parsed }]);
  const { positions } = await buildOrgGraph(bound, { orgId: "verify-pdf", anonymize: true });

  const rootId = positions.find((p) => p.managerId === null)?.id ?? null;
  assert(rootId !== null, "the PDF's reporting lines must resolve to a single root");
  const metrics = computeMetrics(positions, rootId);

  console.log(
    `\n5. PDF → establishment: ${metrics.headcount} positions · ` +
      `$${metrics.totalCost.toLocaleString()} · ${metrics.layers} layers · avg span ${metrics.averageSpan.toFixed(1)}`
  );
  assert(metrics.headcount === TABLE.length - 1, `expected every row, got ${metrics.headcount}`);
  assert(metrics.totalCost === 1216500, `costs did not survive the PDF: $${metrics.totalCost}`);
  // Chief executive → director → manager → coordinator.
  assert(metrics.layers === 4, `reporting lines from the PDF are wrong: ${metrics.layers} layers`);

  console.log("\nALL PDF CHECKS PASSED");
}

endToEnd(main()).catch((err) => {
  console.error(err);
  process.exit(1);
});
