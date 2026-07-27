/**
 * Everything Atlas learned from a real client's files, encoded so it stays
 * learned.
 *
 * Each check here is a defect found against Kinyara Health's actual export —
 * a four-sheet workbook, a payroll listing with a title band above its
 * headers, hourly rates instead of costs, and a structure chart delivered as
 * a slide deck. The client's files can't be committed, so every case is
 * rebuilt here from a fixture with the same shape. What is being defended is
 * not the client: it is the *pattern*, which the next client will also have.
 *
 * Run with `npx tsx --env-file=.env.local scripts/verify-messy-sources.ts`.
 */
import { deflateRawSync } from "node:zlib";

import { parseEstablishmentFile } from "../lib/ingest/parseFile";
import { readSourceFile } from "../lib/ingest/readSource";
import { mapColumns } from "../lib/ingest/columnMapper";
import { bindFiles, type SourceFile } from "../lib/ingest/bindFiles";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { computeMetrics } from "../lib/metrics/diagnostics";
import assumptions from "../config/ingest-assumptions.json";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

const num = (v: string) => Number(String(v ?? "").replace(/[^0-9.\-]/g, "")) || 0;

// --- a real .xlsx, built here so the fixture can't drift -------------------

function sheetXml(grid: string[][]): string {
  const cell = (v: string, ref: string) =>
    v === ""
      ? ""
      : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${v
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")}</t></is></c>`;
  const col = (i: number) => String.fromCharCode(65 + (i % 26));
  const rows = grid
    .map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, `${col(c)}${r + 1}`)).join("")}</row>`)
    .join("");
  return `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

function zip(entries: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(entry.data), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(entry.data), 16);
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

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function workbook(sheets: { name: string; grid: string[][] }[]): Buffer {
  const rels = sheets
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join("");

  return zip([
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          sheets
            .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
            .join("") +
          `</Types>`,
        "utf8"
      ),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
        "utf8"
      ),
    },
    {
      name: "xl/workbook.xml",
      data: Buffer.from(
        `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
          sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
          `</sheets></workbook>`,
        "utf8"
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
        "utf8"
      ),
    },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: Buffer.from(sheetXml(s.grid), "utf8"),
    })),
  ]);
}

// --- fixtures --------------------------------------------------------------

/** One sheet per brand, identical columns, names split, pay as an hourly rate. */
const FRONTLINE_HEADERS = ["EmployeeId", "Category", "BRAND", "FirstName", "Surname", "JobTitle", "FTE", "Rate", "RateUnit"];

function frontlineSheet(brand: string, ids: number[]): string[][] {
  return [
    FRONTLINE_HEADERS,
    ...ids.map((n, i) => [
      String(n),
      "Direct",
      brand,
      `First${n}`,
      `Last${n}`,
      i % 3 === 0 ? "Support Worker" : "Care Companion",
      // Casuals are recorded at zero FTE: no guaranteed hours, not no work.
      i % 2 === 0 ? "0.0" : "0.8",
      "34.42",
      "Hourly",
    ]),
  ];
}

/** A payroll listing that opens with a title band, and whose salaries are pro-rated. */
const PAYROLL_GRID: string[][] = [
  ["Group Payroll — Master List (all brands, all categories)"],
  ["Single source of truth for head-office payroll. Each row = one staff record."],
  [],
  ["Type", "Category", "Source Brand", "Employee / Position", "Role", "Division", "FTE", "Annual Salary (FY26)"],
  ...[
    ["Employee", "Platform", "SAI", "Norbert Walther", "Group CEO", "Executive", "1.00", "260,000"],
    ["Employee", "Platform", "SAI", "Chelsea Cunningham", "Chief Client Officer", "Executive", "1.00", "190,000"],
    ["Employee", "Platform", "SAI", "João Serra e Moura", "Chief Operating Officer", "Executive", "1.00", "195,000"],
    ["Employee", "Platform", "SAI", "Amy Padgham", "General Manager Risk", "Platform", "1.00", "160,000"],
    ["Employee", "Platform", "SAI", "Zoe Cukier", "Community Engagement Manager", "Growth", "1.00", "120,000"],
    ["Employee", "Platform", "SAI", "Nicole Green", "Quality Business Partner", "Quality", "1.00", "110,000"],
    ["Employee", "Semi-Direct", "365C", "Rebekah Chang", "Financial Accountant", "Finance", "1.00", "105,000"],
    ["Employee", "Admin", "365C", "Sophie Hunt", "Instructional Designer", "Platform", "1.00", "100,000"],
    // Part-timers, paid pro rata — the case that gets discounted twice.
    ["Employee", "Semi-Direct", "HAH", "Itai Maenzanise", "Registered Nurse", "HCP", "0.50", "51,000"],
    ["Employee", "Semi-Direct", "HAH", "Priya Nair", "Registered Nurse", "HCP", "0.60", "61,200"],
    ["Employee", "Admin", "HAH", "Debora Gerungan", "Administration", "Head Office", "0.40", "30,000"],
    ["Employee", "Admin", "ACG", "Carly Cronshaw", "Scheduling", "Head Office", "0.20", "15,000"],
    ["Employee", "Semi-Direct", "ACG", "Rutvik Patel", "Workforce Coordinator", "Head Office", "0.50", "40,000"],
    ["Contractor", "Platform", "SAI", "Vacant", "Finance Manager", "Platform", "1.00", "130,000"],
  ],
];

async function main() {
  // --- 1. every sheet of a workbook is read, not just the first ----------
  const frontline = workbook([
    { name: "VIC", grid: frontlineSheet("AgeUp", [101, 102, 103, 104, 105, 106]) },
    { name: "HAH", grid: frontlineSheet("HAH", [201, 202, 203, 204]) },
    { name: "365Care", grid: frontlineSheet("365 Care", [301, 302, 303]) },
    { name: "Accept Care", grid: frontlineSheet("Accept Care", [401, 402]) },
    // A different shape entirely: this one must be reported, not merged.
    { name: "Rate Card", grid: [["Level", "Rate"], ["1", "32.72"], ["2", "34.42"]] },
  ]);

  const read = await readSourceFile("KH_Employee Data.xlsx", frontline);
  assert(read.rows.length === 15, `all four brand sheets must be stacked: expected 15 rows, got ${read.rows.length}`);
  assert(
    read.conversion.detail.includes("Stacked 4 sheets"),
    `the stacking must be stated, not silent: ${read.conversion.detail}`
  );
  assert(
    read.conversion.detail.includes("Rate Card"),
    "a sheet with different columns must be named as left out, not quietly dropped"
  );
  assert(
    read.rows.some((r) => r["Source sheet"] === "365Care"),
    "which sheet a row came from must survive — it is often the only record of the brand"
  );
  console.log(`1. Workbook: ${read.conversion.detail.slice(0, 150)}…`);

  // --- 2. names split across two columns are composed --------------------
  assert(read.rows[0]["Employee Name"] === "First101 Last101", `names must be joined: got "${read.rows[0]["Employee Name"]}"`);
  const frontlineMapping = mapColumns(read.headers);
  assert(
    frontlineMapping.find((m) => m.targetField === "name")?.sourceColumn === "Employee Name",
    "the composed name must win the name field, not the first-name column it was built from"
  );
  console.log(`2. Names: "FirstName" + "Surname" → "${read.rows[0]["Employee Name"]}", and it wins the name field.`);

  // --- 3. an hourly rate is annualised, with the assumption stated -------
  const { fullTimeHoursPerWeek, casualHoursPerWeek, weeksPerYear } = assumptions;
  const casual = read.rows.find((r) => num(r["FTE"]) === 0)!;
  const partTime = read.rows.find((r) => num(r["FTE"]) === 0.8)!;
  assert(
    num(casual["Fully Loaded Cost"]) === Math.round(34.42 * casualHoursPerWeek * weeksPerYear),
    `a casual must be priced on the stated casual hours: got ${casual["Fully Loaded Cost"]}`
  );
  assert(
    num(partTime["Fully Loaded Cost"]) === Math.round(34.42 * fullTimeHoursPerWeek * weeksPerYear),
    `a part-timer must carry the full-time rate, since Atlas prices cost × FTE: got ${partTime["Fully Loaded Cost"]}`
  );
  assert(
    read.conversion.detail.includes(String(casualHoursPerWeek)),
    "the hours assumption must be stated wherever the cost is"
  );
  console.log(
    `3. Hourly rates annualised at ${fullTimeHoursPerWeek}h (${casualHoursPerWeek}h casual) × ${weeksPerYear}w, and says so.`
  );

  // --- 4. a title band above the headers is skipped ----------------------
  const payroll = await readSourceFile("Payroll Listing.xlsx", workbook([{ name: "Group_Payroll", grid: PAYROLL_GRID }]));
  assert(payroll.headers.includes("Annual Salary (FY26)"), `the real header row must be found: got ${payroll.headers.slice(0, 4)}`);
  assert(!payroll.headers.some((h) => h.startsWith("__EMPTY")), "no column may come through as __EMPTY");
  assert(payroll.rows.length === 14, `every data row must survive: got ${payroll.rows.length}`);
  // The blank separator row is dropped as empty before the header search, so
  // what is reported is the two rows that actually carried text.
  assert(
    /2 title or note rows above the column headings were skipped/.test(payroll.conversion.detail),
    `the skipped band must be reported: ${payroll.conversion.detail}`
  );
  console.log(`4. Header row found beneath the title band; ${payroll.headers.length} columns, ${payroll.rows.length} rows.`);

  // --- 5. a pro-rated salary is not discounted twice ---------------------
  const stated = payroll.rows.reduce((s, r) => s + num(r["Annual Salary (FY26)"]), 0);
  const priced = payroll.rows.reduce((s, r) => s + num(r["Fully Loaded Cost"]) * (num(r["FTE"]) || 1), 0);
  assert(
    Math.abs(priced - stated) <= payroll.rows.length,
    `cost × FTE must return the file's own total: file says ${stated}, Atlas prices ${priced}`
  );
  const nurse = payroll.rows.find((r) => r["Employee / Position"] === "Itai Maenzanise")!;
  assert(
    num(nurse["Fully Loaded Cost"]) === 102000,
    `a 0.5 FTE nurse paid 51,000 has a full-time rate of 102,000: got ${nurse["Fully Loaded Cost"]}`
  );
  console.log(
    `5. Pro-rated salaries detected: file total $${stated.toLocaleString()}, Atlas prices $${Math.round(priced).toLocaleString()}.`
  );

  // ...and a file whose costs are already full-time rates is left alone.
  const fullRate = parseEstablishmentFile(
    "full-rate.csv",
    Buffer.from(
      ["Position ID,Employee Name,Position Title,FTE,Fully Loaded Cost",
        ...Array.from({ length: 12 }, (_, i) =>
          `P${i},Person ${i},Role ${i % 3},${i % 2 === 0 ? "1.0" : "0.6"},${95000 + i * 100}`)].join("\n"),
      "utf8"
    )
  );
  const fullRateCosts = fullRate.rows.map((r) => num(r["Fully Loaded Cost"]));
  assert(
    fullRateCosts.every((c) => c >= 95000 && c < 97000),
    "a file whose costs are already full-time rates must not be rescaled"
  );
  console.log(`   A file already stating full-time rates is left untouched.`);

  // --- 6. the whole upload binds into one establishment -------------------
  const sources: SourceFile[] = [
    { filename: "Payroll Listing.xlsx", parsed: payroll },
    { filename: "KH_Employee Data.xlsx", parsed: read },
  ];
  const bound = bindFiles(sources);
  assert(bound.rows.length === 29, `both populations must land: expected 29 rows, got ${bound.rows.length}`);

  const built = await buildOrgGraph(bound, { orgId: "verify-messy", anonymize: false });
  const metrics = computeMetrics(built.positions, built.positions.find((p) => p.managerId === null)?.id ?? null);
  assert(metrics.headcount === 29, `expected 29 positions, got ${metrics.headcount}`);
  assert(metrics.totalCost > 2_000_000, `costs from both files must reach the metrics: got ${metrics.totalCost}`);
  console.log(
    `6. Bound: ${metrics.headcount} positions · $${Math.round(metrics.totalCost).toLocaleString()} across a head-office listing and a four-brand workbook.`
  );

  console.log("\nALL MESSY-SOURCE CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
