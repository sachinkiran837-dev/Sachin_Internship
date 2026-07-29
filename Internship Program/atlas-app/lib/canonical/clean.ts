import { note, type IngestNote } from "@/lib/ingest/notes";

/**
 * The scrub between "what the files said" and "what the engine reasons about".
 *
 * Real exports carry things that are not data: a totals row at the bottom, a
 * column of `#REF!` where a formula broke, `N/A` typed by four different
 * people four different ways, a run of blank rows left by whoever deleted the
 * leavers. Every one of those becomes a person if it is not caught — a
 * "Grand Total" with a $4.2m salary sitting in the establishment as an
 * employee, inflating headcount by one and cost by a fifth.
 *
 * Two rules govern this whole file.
 *
 * The first is that removal is never silent. Deleting rows from a client's
 * data is the single most dangerous thing Atlas does, because the result
 * looks perfect — a clean map with no sign that eleven people are missing. So
 * everything dropped is counted, categorised, and shown back with examples
 * before anyone sees a map built without it.
 *
 * The second is that only unambiguous garbage goes. A row with a name and no
 * salary is incomplete, not garbage, and it stays: the establishment is meant
 * to show that the salary is missing. What gets removed is a row that cannot
 * describe a person at all, or that describes a spreadsheet artefact.
 */

/**
 * Values that mean "nothing here", written the way real exports write it.
 *
 * Deliberately exact matches on the whole trimmed cell, never substrings —
 * "NA" is a placeholder, "NA Region Manager" is a job.
 */
const PLACEHOLDERS = new Set([
  "n/a",
  "n\\a",
  "na",
  "n.a.",
  "none",
  "null",
  "nil",
  "nan",
  "-",
  "--",
  "---",
  "—",
  "–",
  ".",
  "?",
  "??",
  "tbc",
  "tbd",
  "to be confirmed",
  "unknown",
  "not known",
  "not applicable",
  "not stated",
  "blank",
  "#n/a",
  "#ref!",
  "#value!",
  "#name?",
  "#div/0!",
  "#null!",
  "#num!",
  "0000-00-00",
]);

/** A row whose first meaningful cell is one of these is a spreadsheet artefact. */
const TOTAL_ROW = /^(grand\s+)?(total|totals|subtotal|sub-total|sum|count|average|mean)\b/i;

export interface DropReason {
  reason: string;
  count: number;
  /** A few of the actual rows, so the client can check the rule was right. */
  examples: string[];
}

export interface CleaningLedger {
  rowsIn: number;
  rowsOut: number;
  dropped: DropReason[];
  /** Cells that were repaired rather than removed. */
  repaired: { reason: string; count: number }[];
}

export const EMPTY_LEDGER: CleaningLedger = { rowsIn: 0, rowsOut: 0, dropped: [], repaired: [] };

/**
 * Normalises one cell.
 *
 * Whitespace and invisible characters are repaired because they are transport
 * damage — a name that arrived with a non-breaking space in it is the same
 * name, and leaving it in means "Jane  Smith" and "Jane Smith" become two
 * people. Case is deliberately left alone: an ALL-CAPS surname is how the
 * client's system holds it, and rewriting it would be Atlas editing their
 * records rather than reading them.
 */
function cleanCell(raw: string): { value: string; repaired: string | null } {
  // Non-breaking spaces, zero-width joiners and the BOM survive CSV export
  // and are invisible in every viewer, including the one someone would use
  // to check why two identical-looking names didn't match.
  const stripped = raw.replace(/[ ​-‍﻿]/g, " ");
  const collapsed = stripped.replace(/\s+/g, " ").trim();

  if (collapsed !== raw.trim() || /\s\s/.test(raw)) {
    if (PLACEHOLDERS.has(collapsed.toLowerCase())) {
      return { value: "", repaired: "placeholder text read as empty" };
    }
    return { value: collapsed, repaired: "stray or invisible whitespace removed" };
  }

  if (PLACEHOLDERS.has(collapsed.toLowerCase())) {
    return { value: "", repaired: "placeholder text read as empty" };
  }

  return { value: collapsed, repaired: null };
}

/** The fields that, between them, decide whether a row describes anybody. */
const IDENTIFYING = ["name", "title", "positionId"] as const;

function describe(row: Record<string, string>): string {
  const parts = Object.entries(row)
    .filter(([, v]) => v.trim() !== "")
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${v}`);
  return parts.length > 0 ? parts.join(", ") : "(every cell empty)";
}

export function cleanRows(rows: Record<string, string>[]): {
  rows: Record<string, string>[];
  ledger: CleaningLedger;
} {
  const repairs = new Map<string, number>();
  const drops = new Map<string, { count: number; examples: string[] }>();

  const drop = (reason: string, row: Record<string, string>) => {
    const entry = drops.get(reason) ?? { count: 0, examples: [] };
    entry.count += 1;
    if (entry.examples.length < 3) entry.examples.push(describe(row));
    drops.set(reason, entry);
  };

  const kept: Record<string, string>[] = [];

  for (const row of rows) {
    const cleaned: Record<string, string> = {};
    for (const [column, raw] of Object.entries(row)) {
      const { value, repaired } = cleanCell(raw ?? "");
      cleaned[column] = value;
      if (repaired) repairs.set(repaired, (repairs.get(repaired) ?? 0) + 1);
    }

    const values = Object.values(cleaned).filter((v) => v !== "");

    if (values.length === 0) {
      drop("Every cell was empty", row);
      continue;
    }

    // A totals line carries a real figure in a real column, so nothing else
    // here would catch it — and it is the one that does the most damage,
    // because it lands in the establishment as an extremely expensive person.
    const first = values[0];
    if (TOTAL_ROW.test(first)) {
      drop("A totals or subtotal line, not a person", row);
      continue;
    }

    if (IDENTIFYING.every((field) => (cleaned[field] ?? "") === "")) {
      drop("Nothing identifying anyone — no name, job title or position ID", row);
      continue;
    }

    kept.push(cleaned);
  }

  return {
    rows: kept,
    ledger: {
      rowsIn: rows.length,
      rowsOut: kept.length,
      dropped: [...drops.entries()]
        .map(([reason, { count, examples }]) => ({ reason, count, examples }))
        .sort((a, b) => b.count - a.count),
      repaired: [...repairs.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    },
  };
}

/**
 * The ledger as something the client reads before they see a map.
 *
 * Returns null when nothing was dropped: a note saying "0 rows removed" is
 * noise, and noise is what stops the ones that matter from being read.
 * Repairs alone never raise a note — collapsing a double space changes no
 * count, no cost and no reporting line.
 */
export function cleaningNote(ledger: CleaningLedger): IngestNote | null {
  const removed = ledger.rowsIn - ledger.rowsOut;
  if (removed <= 0) return null;

  const share = ledger.rowsIn === 0 ? 0 : (removed / ledger.rowsIn) * 100;

  return note("cleaning", "assumption", {
    topic: "Rows Atlas discarded",
    statement:
      `${removed.toLocaleString()} of ${ledger.rowsIn.toLocaleString()} rows were removed before anything was ` +
      `built, because they did not describe a person.`,
    evidence: ledger.dropped
      .map((d) => `${d.count.toLocaleString()} — ${d.reason.toLowerCase()} (e.g. ${d.examples[0]})`)
      .join("; "),
    effect:
      `Every count, cost and comparison on the following screens is of the ${ledger.rowsOut.toLocaleString()} rows ` +
      `that remained${share >= 10 ? `, which is ${(100 - share).toFixed(0)}% of what you uploaded` : ""}. ` +
      `If any of these were real people, say so below and Atlas will read the files again.`,
  });
}
