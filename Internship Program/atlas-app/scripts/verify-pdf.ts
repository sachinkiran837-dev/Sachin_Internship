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

  // --- 5. a drawn structure chart: boxes and elbow connectors ----------
  checkChart("5. Drawn org chart (boxes + connectors)", buildChartPdf(true));

  // --- 6. the same chart with no connector lines at all ----------------
  checkChart("6. Drawn org chart (layout only, no connectors)", buildChartPdf(false));

  return { table: buildPdf(TABLE, COLUMN_X, { subsetFont: true }), chart: buildChartPdf(true) };
}

/**
 * A real structure chart: a CEO over two directors, each over two reports,
 * drawn as rectangles joined by the elbow connectors every chart tool emits
 * (down from the parent, across, then down into each child).
 */
const CHART: { label: string[]; x: number; row: number }[] = [
  { label: ["Dana Whitfield", "Chief Executive"], x: 235, row: 0 },
  { label: ["Ravi Anand", "Director of Operations"], x: 85, row: 1 },
  { label: ["Mei Lin", "Director of Finance"], x: 385, row: 1 },
  { label: ["Tom Beckett", "Operations Manager"], x: 20, row: 2 },
  { label: ["Sara Cole", "Service Coordinator"], x: 165, row: 2 },
  { label: ["Jonah Reed", "Finance Manager"], x: 320, row: 2 },
  { label: ["Priya Nair", "Payroll Officer"], x: 465, row: 2 },
];
const BOX_W = 130;
const BOX_H = 40;
const ROW_Y = [700, 580, 460];

function buildChartPdf(withConnectors: boolean): Buffer {
  const ops: string[] = [];
  const box = (i: number) => {
    const b = CHART[i];
    return { x: b.x, y: ROW_Y[b.row], w: BOX_W, h: BOX_H };
  };

  // Boxes.
  CHART.forEach((_, i) => {
    const b = box(i);
    ops.push(`${b.x} ${b.y} ${b.w} ${b.h} re S`);
  });

  // Elbow connectors from each parent to its children.
  if (withConnectors) {
    const children: Record<number, number[]> = { 0: [1, 2], 1: [3, 4], 2: [5, 6] };
    for (const [parentId, kids] of Object.entries(children)) {
      const p = box(Number(parentId));
      const midY = p.y - 30;
      const px = p.x + p.w / 2;
      ops.push(`${px} ${p.y} m ${px} ${midY} l S`);
      for (const kid of kids) {
        const c = box(kid);
        const cx = c.x + c.w / 2;
        ops.push(`${px} ${midY} m ${cx} ${midY} l S`);
        ops.push(`${cx} ${midY} m ${cx} ${c.y + c.h} l S`);
      }
    }
  }

  // Text inside each box: name on the upper line, title beneath.
  ops.push("BT", "/F1 9 Tf");
  CHART.forEach((entry, i) => {
    const b = box(i);
    ops.push(`1 0 0 1 ${b.x + 6} ${b.y + b.h - 14} Tm`, `(${entry.label[0]}) Tj`);
    ops.push(`1 0 0 1 ${b.x + 6} ${b.y + b.h - 28} Tm`, `(${entry.label[1]}) Tj`);
  });
  ops.push("ET");

  const content = deflateSync(Buffer.from(ops.join("\n"), "latin1"));
  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n${content.toString("latin1")}\nendstream\nendobj\n`,
    `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`,
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

function checkChart(label: string, pdf: Buffer) {
  const parsed = parsePdfFile("structure-chart.pdf", pdf);

  console.log(`\n${label}`);
  console.log(`   ${parsed.conversion.detail}`);

  assert(
    parsed.rows.length === CHART.length,
    `expected ${CHART.length} boxed roles, got ${parsed.rows.length}`
  );
  assert(
    Boolean(parsed.conversion.needsReview),
    "a structure read from a drawing must be flagged for review — the hierarchy is inferred"
  );

  const byName = new Map(parsed.rows.map((r) => [r["Employee Name"], r]));
  const idToName = new Map(parsed.rows.map((r) => [r["Position ID"], r["Employee Name"]]));
  const managerOf = (name: string) => idToName.get(byName.get(name)?.["Manager ID"] ?? "") ?? null;

  // The name/title split has to survive, or every box becomes "Unspecified".
  assert(
    byName.get("Dana Whitfield")?.["Position Title"] === "Chief Executive",
    `name and title were not separated: ${JSON.stringify(parsed.rows[0])}`
  );

  assert(managerOf("Dana Whitfield") === null, "the chief executive must be the root");
  for (const [child, parent] of [
    ["Ravi Anand", "Dana Whitfield"],
    ["Mei Lin", "Dana Whitfield"],
    ["Tom Beckett", "Ravi Anand"],
    ["Sara Cole", "Ravi Anand"],
    ["Jonah Reed", "Mei Lin"],
    ["Priya Nair", "Mei Lin"],
  ] as const) {
    assert(
      managerOf(child) === parent,
      `${child} should report to ${parent}, got ${managerOf(child) ?? "nobody"}`
    );
  }

  console.log(`   all 7 reporting lines resolved correctly`);
}

/** The point of all of the above: a PDF becomes a working establishment. */
async function endToEnd({ table, chart }: { table: Buffer; chart: Buffer }) {
  const { readSourceFile } = await import("../lib/ingest/readSource");
  const { bindFiles } = await import("../lib/ingest/bindFiles");
  const { buildOrgGraph } = await import("../lib/ingest/buildGraph");
  const { computeMetrics } = await import("../lib/metrics/diagnostics");

  async function build(filename: string, pdf: Buffer) {
    const parsed = await readSourceFile(filename, pdf);
    const bound = bindFiles([{ filename, parsed }]);
    const { positions } = await buildOrgGraph(bound, { orgId: "verify-pdf", anonymize: true });
    const rootId = positions.find((p) => p.managerId === null)?.id ?? null;
    assert(rootId !== null, `${filename} must resolve to a single root`);
    return computeMetrics(positions, rootId);
  }

  const fromTable = await build("establishment.pdf", table);
  console.log(
    `\n7. Tabular PDF → establishment: ${fromTable.headcount} positions · ` +
      `$${fromTable.totalCost.toLocaleString()} · ${fromTable.layers} layers · avg span ${fromTable.averageSpan.toFixed(1)}`
  );
  assert(fromTable.headcount === TABLE.length - 1, `expected every row, got ${fromTable.headcount}`);
  assert(fromTable.totalCost === 1216500, `costs did not survive the PDF: $${fromTable.totalCost}`);
  // Chief executive → director → manager → coordinator.
  assert(fromTable.layers === 4, `reporting lines from the PDF are wrong: ${fromTable.layers} layers`);

  const fromChart = await build("structure-chart.pdf", chart);
  console.log(
    `8. Drawn chart → establishment: ${fromChart.headcount} positions · ` +
      `${fromChart.layers} layers · avg span ${fromChart.averageSpan.toFixed(1)}`
  );
  assert(fromChart.headcount === CHART.length, `expected every box, got ${fromChart.headcount}`);
  // Chief executive → two directors → four reports.
  assert(fromChart.layers === 3, `the drawn hierarchy is wrong: ${fromChart.layers} layers`);
  assert(
    Math.abs(fromChart.averageSpan - 2) < 0.01,
    `each of the three managers should have two reports, got ${fromChart.averageSpan}`
  );

  console.log("\nALL PDF CHECKS PASSED");
}

endToEnd(main()).catch((err) => {
  console.error(err);
  process.exit(1);
});
