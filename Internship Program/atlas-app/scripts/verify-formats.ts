/**
 * Verifies the readers added for "upload anything": Word tables, and the
 * rule that one unreadable file never takes the rest of the batch down with
 * it. The image/PDF path is exercised as far as it can be without spending
 * an API call — its refusal message when no key is configured is itself a
 * behaviour worth pinning, since that is what a client sees on a deployment
 * with no ANTHROPIC_API_KEY.
 *
 * Run with `npx tsx --env-file=.env.local scripts/verify-formats.ts`.
 */
import { deflateRawSync } from "node:zlib";

import { formatFor, MAX_UPLOAD_BYTES, SUPPORTED_FORMATS } from "../lib/ingest/formats";
import { readSourceFile } from "../lib/ingest/readSource";
import { UnsupportedFileError } from "../lib/ingest/parseFile";
import { bindFiles, type SourceFile } from "../lib/ingest/bindFiles";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { computeMetrics } from "../lib/metrics/diagnostics";
import { hasAI } from "../lib/ai/client";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

// --- a real .docx, built here so the fixture can't drift ------------------

function zip(entries: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt32LE(0, 14); // crc — not checked by the reader
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, compressed);
    centrals.push(central);
    offset += local.length + compressed.length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, cd, eocd]);
}

function docxWithTable(headers: string[], rows: string[][]): Buffer {
  const cell = (text: string) =>
    `<w:tc><w:p><w:r><w:t>${text.replace(/&/g, "&amp;")}</w:t></w:r></w:p></w:tc>`;
  const tr = (cells: string[]) => `<w:tr>${cells.map(cell).join("")}</w:tr>`;

  const document =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
    `<w:p><w:r><w:t>Appendix B — establishment</w:t></w:r></w:p>` +
    // A small furniture table that must lose to the real one.
    `<w:tbl>${tr(["Version", "Date"])}${tr(["1.2", "2026-03-01"])}</w:tbl>` +
    `<w:tbl>${tr(headers)}${rows.map(tr).join("")}</w:tbl>` +
    `</w:body></w:document>`;

  return zip([
    { name: "[Content_Types].xml", data: Buffer.from("<Types/>", "utf8") },
    { name: "word/document.xml", data: Buffer.from(document, "utf8") },
  ]);
}

const DOCX_ROWS = [
  ["P100", "Dana Whitfield", "Chief Executive", "Executive", "", "410000"],
  ["P101", "Ravi Anand", "Director of Operations", "Operations", "P100", "265000"],
  ["P102", "Mei Lin", "Operations Manager", "Operations", "P101", "175000"],
  ["P103", "Tom Beckett", "Operations Manager", "Operations", "P101", "172000"],
  ["P104", "Sara Cole", "Coordinator", "Operations", "P102", "98000"],
];

async function main() {
  // --- 1. a Word table becomes an establishment -------------------------
  const docx = docxWithTable(
    ["Position ID", "Employee Name", "Position Title", "Department", "Manager ID", "Fully Loaded Cost"],
    DOCX_ROWS
  );
  const parsedDocx = await readSourceFile("structure-appendix.docx", docx);

  console.log(`1. Word  → ${parsedDocx.conversion.detail}`);
  assert(parsedDocx.rows.length === DOCX_ROWS.length, `expected ${DOCX_ROWS.length} rows, got ${parsedDocx.rows.length}`);
  assert(parsedDocx.headers.length === 6, `expected 6 columns, got ${parsedDocx.headers.length}`);
  assert(
    parsedDocx.conversion.detail.includes("1 smaller table"),
    "the version-history table should be reported as ignored, not silently dropped"
  );
  assert(
    parsedDocx.rows[0]["Employee Name"] === "Dana Whitfield",
    `cell text was mangled: ${JSON.stringify(parsedDocx.rows[0])}`
  );

  // --- 2. a Word file with no table is refused, with a reason ------------
  const proseOnly = zip([
    {
      name: "word/document.xml",
      data: Buffer.from(
        `<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>We propose removing a layer.</w:t></w:r></w:p></w:body></w:document>`,
        "utf8"
      ),
    },
  ]);
  const proseError = await readSourceFile("proposal.docx", proseOnly).catch((e: Error) => e);
  assert(proseError instanceof UnsupportedFileError, "a table-less Word file must be refused, not guessed at");
  assert(
    (proseError as Error).message.includes("no tables"),
    `refusal must say why: ${(proseError as Error).message}`
  );
  console.log(`2. Word (prose only) → refused: ${(proseError as Error).message.slice(0, 72)}…`);

  // --- 3. images: routed to the vision reader, refused without a key -----
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  assert(formatFor("org-chart.png")?.kind === "visual", "a .png must route to the vision reader");
  assert(formatFor("board-pack.pdf")?.kind === "visual", "a .pdf must route to the vision reader");

  if (hasAI()) {
    console.log("3. Images → ANTHROPIC_API_KEY is set; skipping the live vision call.");
  } else {
    const imageError = await readSourceFile("org-chart.png", png).catch((e: Error) => e);
    assert(imageError instanceof UnsupportedFileError, "a refused image must be an UnsupportedFileError");
    const msg = (imageError as Error).message;
    assert(
      msg.includes("ANTHROPIC_API_KEY") && msg.includes("CSV"),
      `the refusal must name the missing key and the way round it: ${msg}`
    );
    console.log(`3. Images (no key) → refused, and says why: ${msg.slice(0, 72)}…`);
  }

  // --- 4. one bad file must not take the batch down ---------------------
  const roster = DOCX_ROWS.map((r) => ({
    "Position ID": r[0],
    "Employee Name": r[1],
    "Position Title": r[2],
    Department: r[3],
    "Manager ID": r[4],
  }));
  const payroll = DOCX_ROWS.map((r) => ({ "Staff ID": r[0], Remuneration: r[5] }));

  const toCsv = (rows: Record<string, string>[]) =>
    [Object.keys(rows[0]).join(","), ...rows.map((r) => Object.values(r).join(","))].join("\n");

  const filenames: [string, Buffer][] = [
    ["roster.csv", Buffer.from(toCsv(roster), "utf8")],
    ["chart.png", png], // unreadable without a key
    ["payroll.csv", Buffer.from(toCsv(payroll), "utf8")],
    ["notes.rtf", Buffer.from("{\\rtf1 nothing useful}", "utf8")], // unsupported outright
  ];

  const sources: SourceFile[] = [];
  for (const [name, buffer] of filenames) {
    try {
      sources.push({ filename: name, parsed: await readSourceFile(name, buffer) });
    } catch (err) {
      sources.push({ filename: name, error: (err as Error).message });
    }
  }

  const bound = bindFiles(sources);
  console.log("\n4. Mixed batch:");
  for (const b of bound.bindings) console.log(`   ── ${b.filename} [${b.role}] ${b.detail.slice(0, 90)}…`);

  assert(bound.rows.length === DOCX_ROWS.length, `the good files must still bind: got ${bound.rows.length} rows`);
  assert(
    bound.bindings.map((b) => b.filename).join(",") === filenames.map(([n]) => n).join(","),
    "files must be reported back in upload order"
  );
  const rtf = bound.bindings.find((b) => b.filename === "notes.rtf")!;
  assert(rtf.role === "unusable", "an unsupported file must be reported unusable");
  assert(rtf.detail.startsWith("Not used."), `an unusable file must say so first: ${rtf.detail}`);

  const { positions } = await buildOrgGraph(bound, { orgId: "verify-formats", anonymize: true });
  const rootId = positions.find((p) => p.managerId === null)?.id ?? null;
  const metrics = computeMetrics(positions, rootId);
  assert(metrics.totalCost > 0, "cost from payroll.csv must have survived a batch containing failures");
  console.log(
    `   → still built: ${metrics.headcount} positions · $${metrics.totalCost.toLocaleString()} · ${metrics.layers} layers`
  );

  // --- 5. every advertised format routes somewhere ----------------------
  for (const f of SUPPORTED_FORMATS) {
    assert(formatFor(`example${f.ext}`)?.ext === f.ext, `${f.ext} is advertised but doesn't resolve`);
  }
  console.log(`\n5. All ${SUPPORTED_FORMATS.length} advertised formats resolve to a reader.`);
  console.log(`   Upload ceiling: ${(MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(0)}MB per submission.`);

  console.log("\nALL FORMAT CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
