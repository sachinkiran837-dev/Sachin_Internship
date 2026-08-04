/**
 * A permissive date reader for the two date-shaped fields D2/D3 need
 * (start date, vacancy date). HR exports carry dates in whatever the source
 * system's locale writes them in — this handles ISO (`2019-03-14`) and the
 * two common day-first/month-first slash formats, and refuses anything
 * ambiguous rather than guessing which of DD/MM and MM/DD it's holding.
 *
 * Returns an ISO `YYYY-MM-DD` string so every downstream tenure/age
 * computation compares on one format, or null when the value can't be read
 * as a date at all — never a fabricated date.
 */
export function parseLooseDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // ISO, or anything Date.parse already reads unambiguously (e.g. "14 Mar 2019").
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return isValid(Number(y), Number(m), Number(d)) ? `${y}-${m}-${d}` : null;
  }

  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (slash) {
    const [, a, b, year] = slash;
    const first = Number(a);
    const second = Number(b);
    // Unambiguous only when one side can't possibly be a month — otherwise
    // DD/MM and MM/DD both read as valid dates and guessing either way is a
    // coin flip that silently mis-dates part of the establishment.
    if (first > 12 && second <= 12) return isoOf(year, second, first);
    if (second > 12 && first <= 12) return isoOf(year, first, second);
    return null;
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    return isoOf(String(d.getUTCFullYear()), d.getUTCMonth() + 1, d.getUTCDate());
  }

  return null;
}

function isValid(y: number, m: number, d: number): boolean {
  return y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

function isoOf(year: string, month: number, day: number): string | null {
  const y = Number(year);
  if (!isValid(y, month, day)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Whole days between an ISO date string and now. Null propagates from an unparseable input. */
export function daysSince(isoDate: string | null, now: Date = new Date()): number | null {
  if (!isoDate) return null;
  const then = Date.parse(isoDate);
  if (Number.isNaN(then)) return null;
  return Math.floor((now.getTime() - then) / (1000 * 60 * 60 * 24));
}
