/**
 * One-off generator for the bigger, messier, frontline-heavy demo dataset.
 * Not part of the app's runtime — run with `npx tsx
 * scripts/generate-meridian-full.ts` to regenerate
 * db/seed-data/meridian-full-establishment.csv. Kept separate from the
 * smaller db/seed-data/sample-establishment.csv, which scripts/verify-pipeline.ts
 * asserts exact numbers against and must stay untouched.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

interface Row {
  id: string;
  name: string;
  title: string;
  department: string;
  managerRef: string; // another row's id, a row's name, or "" for root
  cost: number;
  fte: string;
  status: string;
}

const rows: Row[] = [];
let counter = 1;
function nextId(): string {
  const id = `P${String(counter).padStart(3, "0")}`;
  counter += 1;
  return id;
}

// Deterministic name pool (fictional, no relation to any real person) —
// enough variety to avoid obvious repetition across ~150 rows.
const FIRST = [
  "Olivia", "Liam", "Amara", "Noah", "Priya", "Ethan", "Zainab", "Lucas", "Freya", "Kai",
  "Isabella", "Mateo", "Aisha", "Jack", "Chidi", "Grace", "Rohan", "Mia", "Tane", "Sofia",
  "Hana", "Omar", "Ingrid", "Diego", "Layla", "Finn", "Mei", "Owen", "Nadia", "Theo",
  "Aroha", "Sione", "Ruby", "Kofi", "Elena", "Marco", "Yuki", "Sam", "Anika", "Wiremu",
  "Chloe", "Ravi", "Fatima", "Callum", "Ngozi", "Bianca", "Ahmad", "Talia", "Jonas", "Mele",
];
const LAST = [
  "Nguyen", "O'Sullivan", "Okafor", "Chen", "Kaur", "Fitzgerald", "Al-Amin", "Rossi", "Tamati", "Novak",
  "Solberg", "Fernandez", "Ibrahim", "Whitfield", "Osei", "Campbell", "Patel", "Dela Cruz", "Ngata", "Andersen",
  "Kobayashi", "Hassan", "Murphy", "Silva", "Karim", "O'Brien", "Zhao", "Brooks", "Hussain", "Papadopoulos",
  "Ah Kuoi", "Faleolo", "Bianchi", "Mensah", "Kowalski", "Esposito", "Tanaka", "Wilson", "Verma", "Rangi",
];
let nameCursor = 0;
function nextName(messy: "normal" | "spaced" | "caps" | "lower" | "comma" = "normal"): string {
  const first = FIRST[nameCursor % FIRST.length];
  const last = LAST[(nameCursor * 7 + 3) % LAST.length];
  nameCursor += 1;
  switch (messy) {
    case "spaced":
      return `  ${first}   ${last}  `;
    case "caps":
      return `${first.toUpperCase()} ${last.toUpperCase()}`;
    case "lower":
      return `${first.toLowerCase()} ${last.toLowerCase()}`;
    case "comma":
      return `${last}, ${first}`;
    default:
      return `${first} ${last}`;
  }
}
const MESSY_CYCLE: Array<"normal" | "spaced" | "caps" | "lower" | "comma"> = [
  "normal", "normal", "normal", "spaced", "normal", "caps", "normal", "normal", "lower", "normal", "comma", "normal",
];
let messyCursor = 0;
function messyName(): string {
  const style = MESSY_CYCLE[messyCursor % MESSY_CYCLE.length];
  messyCursor += 1;
  return nextName(style);
}

const COST_STYLES = [
  (n: number) => String(n),
  (n: number) => `$${n.toLocaleString("en-US")}`,
  (n: number) => `${n}.00`,
  (n: number) => `AUD ${n}`,
  (n: number) => `${n.toLocaleString("en-US")}`,
];
let costCursor = 0;
function cost(n: number): string {
  const f = COST_STYLES[costCursor % COST_STYLES.length];
  costCursor += 1;
  return f(n);
}

const FTE_STYLES = ["1", "1.0", "0.8", "0.6", "1", "0.5", "1"];
let fteCursor = 0;
function fte(): string {
  const v = FTE_STYLES[fteCursor % FTE_STYLES.length];
  fteCursor += 1;
  return v;
}

const STATUS_FILLED = ["Filled", "filled", "FILLED", "Filled "];
let statusCursor = 0;
function filledStatus(): string {
  const v = STATUS_FILLED[statusCursor % STATUS_FILLED.length];
  statusCursor += 1;
  return v;
}

function add(
  title: string,
  department: string,
  managerRef: string,
  costValue: number,
  opts: { status?: string; fteOverride?: string; nameStyle?: "normal" | "spaced" | "caps" | "lower" | "comma" } = {}
): string {
  const id = nextId();
  rows.push({
    id,
    name: opts.status === "vacant" ? "Vacant" : nextName(opts.nameStyle ?? MESSY_CYCLE[messyCursor++ % MESSY_CYCLE.length]),
    title,
    department,
    managerRef,
    cost: costValue,
    fte: opts.fteOverride ?? fte(),
    status: opts.status ?? filledStatus(),
  });
  return id;
}

// ---- Executive ----
const ceo = add("Chief Executive Officer", "Executive", "", 430000);
const cfo = add("Chief Financial Officer", "Finance", ceo, 325000);
const coo = add("Chief Operating Officer", "Clinical Operations", ceo, 325000);
add("Company Secretary", "Executive", ceo, 215000);
const cpo = add("Chief People Officer", "People & Culture", ceo, 285000);
const itMgr = add("IT Manager", "Corporate Services", ceo, 178000);

// ---- Clinical Operations ----
add("Chief Safety Officer", "Clinical Operations", coo, 228000);
const clinDir = add("Clinical Director", "Clinical Operations", coo, 262000);
const opsMgr = add("Operations Manager", "Facilities", coo, 172000);
const psm1 = add("Patient Services Manager", "Clinical Operations", coo, 160000);
const psm2 = add("Patient Services Manager", "Clinical Operations", coo, 158000);

const don = add("Director of Nursing", "Clinical Operations", clinDir, 232000);
const clinCoord = add("Clinical Coordinator", "Clinical Operations", clinDir, 137000);

add("Clinical Educator", "Clinical Operations", clinCoord, 119000);
add("Clinical Educator", "Clinical Operations", clinCoord, 118000);
const alliedLead = add("Allied Health Lead", "Clinical Operations", clinCoord, 128000);
for (let i = 0; i < 3; i++) {
  add("Physiotherapy Assistant", "Clinical Operations", alliedLead, 78000 + i * 1000);
}

// Six Nurse Unit Managers, deliberately uneven spans (one thin, several wide).
const numSpans = [12, 11, 10, 3, 13, 9];
numSpans.forEach((span, idx) => {
  const num = add("Nurse Unit Manager", "Clinical Operations", don, 168000 + idx * 1000);
  for (let i = 0; i < span; i++) {
    const roll = (idx * 17 + i) % 5;
    const title = roll === 0 ? "Enrolled Nurse" : roll === 1 ? "Personal Care Assistant" : "Registered Nurse";
    const baseCost = title === "Registered Nurse" ? 97000 : title === "Enrolled Nurse" ? 82000 : 68000;
    const isVacant = idx === 1 && i === 3;
    add(title, "Clinical Operations", num, baseCost + (i % 4) * 500, {
      status: isVacant ? "vacant" : undefined,
    });
  }
});

// Agency (contract) nursing pool — the frontline contractor cohort.
const agencyCoord = add("Agency Nursing Coordinator", "Clinical Operations", don, 142000);
for (let i = 0; i < 8; i++) {
  add("Agency Registered Nurse", "Clinical Operations", agencyCoord, 108000 + (i % 3) * 1500, {
    status: i % 3 === 0 ? "Contract" : i % 3 === 1 ? "contingent" : "Contingent",
  });
}

// Patient Services Officers under two managers (one wide, one healthy).
[psm1, psm2].forEach((mgr, mi) => {
  const count = mi === 0 ? 10 : 9;
  for (let i = 0; i < count; i++) {
    add("Patient Services Officer", "Clinical Operations", mgr, 72000 + (i % 3) * 500);
  }
});

// ---- Facilities / hospitality / security (the non-clinical support & contractor cohort) ----
const facCoord = add("Facilities Coordinator", "Facilities", opsMgr, 89000);
for (let i = 0; i < 3; i++) {
  add("Facilities Technician", "Facilities", facCoord, 77000 + i * 500);
}
for (let i = 0; i < 6; i++) {
  add("Cleaning Contractor", "Facilities", facCoord, 58000 + (i % 2) * 1000, { status: "Contingent" });
}

const cateringMgr = add("Catering Manager", "Facilities", opsMgr, 96000);
for (let i = 0; i < 6; i++) {
  add(i % 2 === 0 ? "Kitchen Hand" : "Hospitality Assistant", "Facilities", cateringMgr, 55000 + i * 400);
}

const secCoord = add("Security Coordinator", "Facilities", opsMgr, 91000);
for (let i = 0; i < 4; i++) {
  add("Security Contractor", "Facilities", secCoord, 62000 + i * 500, { status: "contract" });
}

for (let i = 0; i < 3; i++) {
  add("Maintenance Contractor", "Facilities", opsMgr, 64000 + i * 500, { status: "Contingent" });
}

// ---- People & Culture ----
add("HR Business Partner", "People & Culture", cpo, 146000);
add("Recruitment Lead", "People & Culture", cpo, 133000);
add("Learning & Development Coordinator", "People & Culture", cpo, 99000, { fteOverride: "0.6" });
add("Privacy Officer", "People & Culture", cpo, 121000);

// ---- Finance ----
const finDir = add("Finance Director", "Finance", cfo, 241000);
const finCtrl = add("Financial Controller", "Finance", finDir, 191000);
add("Accounts Payable Lead", "Finance", finCtrl, 106000);
add("Payroll Officer", "Finance", finCtrl, 99000);
for (let i = 0; i < 3; i++) {
  add("Finance Analyst", "Finance", finCtrl, 103000 + i * 500);
}

// ---- Corporate Services (IT) ----
for (let i = 0; i < 3; i++) {
  add("IT Support Officer", "Corporate Services", itMgr, 79000 + i * 500);
}

// ---- Deliberate messiness: one duplicate Position ID, one unresolvable orphan ----
// Duplicate: re-emit an existing id on an otherwise-new row (kept first,
// second dropped — exercises the ingest dedup path).
const dupTarget = rows[Math.floor(rows.length / 2)];
rows.push({
  id: dupTarget.id,
  name: messyName(),
  title: "Registered Nurse",
  department: "Clinical Operations",
  managerRef: don,
  cost: 97500,
  fte: "1",
  status: "Filled",
});

// Orphan: manager reference points at an id that doesn't exist in this file.
rows.push({
  id: nextId(),
  name: messyName(),
  title: "Registered Nurse",
  department: "Clinical Operations",
  managerRef: "P900",
  cost: 96500,
  fte: "1",
  status: "Filled",
});

// A manager referenced by name instead of ID, on a contractor row (both
// reference styles show up in the wild).
const facCoordRow = rows.find((r) => r.id === facCoord)!;
rows.push({
  id: nextId(),
  name: messyName(),
  title: "Cleaning Contractor",
  department: "Facilities",
  managerRef: facCoordRow.name.trim(),
  cost: 57500,
  fte: "1",
  status: "Contingent",
});

const header = [
  "Position ID",
  "Employee Name",
  "Position Title",
  "Department",
  "Manager ID",
  "Fully Loaded Cost",
  "FTE",
  "Status",
];

function csvCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const lines = [header.join(",")];
for (const r of rows) {
  const cells = [r.id, r.name, r.title, r.department, r.managerRef, cost(r.cost), r.fte, r.status].map(
    csvCell
  );
  lines.push(cells.join(","));
}

const outPath = path.join(process.cwd(), "db", "seed-data", "meridian-full-establishment.csv");
writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
console.log(`Wrote ${rows.length} rows to ${outPath}`);
