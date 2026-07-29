/**
 * Money, formatted in one place.
 *
 * Atlas reads whatever an organisation exports, and an establishment file
 * never says what currency it is in — a column of `62000` is 62,000 of
 * something, and nothing in the data distinguishes pounds from dollars from
 * rupees. So the currency is a property of the deployment rather than of the
 * data, set once here and never inferred.
 *
 * That is a deliberate refusal rather than a gap. Guessing it from anything
 * available — a locale, a file name, a sector — would put a currency symbol
 * in front of every figure on every screen on the strength of a hint, and the
 * one thing worse than an unlabelled number in a board pack is a confidently
 * mislabelled one.
 *
 * Fourteen copies of `new Intl.NumberFormat("en-AU", …)` used to be scattered
 * across the pages and the play engine. One of them would have been missed
 * the first time this changed.
 */

const CURRENCY = process.env.NEXT_PUBLIC_ATLAS_CURRENCY?.trim() || "AUD";
const LOCALE = process.env.NEXT_PUBLIC_ATLAS_LOCALE?.trim() || "en-AU";

const standard = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
  maximumFractionDigits: 0,
});

/**
 * The same figure shortened — "$12M" rather than "$12,043,918".
 *
 * Only for places where a column of full figures would be unreadable, and
 * never where the exact number is the point. A saving a client will be held
 * to is always shown in full.
 */
const compact = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
  maximumFractionDigits: 1,
  notation: "compact",
});

export function currency(value: number): string {
  return standard.format(value);
}

export function currencyCompact(value: number, threshold = 1_000_000): string {
  return Math.abs(value) >= threshold ? compact.format(value) : standard.format(value);
}

/** The code in use, for anywhere that has to name it rather than show it. */
export const CURRENCY_CODE = CURRENCY;
