/**
 * What the client told Atlas after seeing the first read of their data.
 *
 * This is the other half of the register in `notes.ts`. Atlas ingests, states
 * what it could not resolve, and the client answers; the answers are stored
 * against the establishment and the ingest is run again from the same bytes
 * with them applied. Nothing here is a preference or a setting — every field
 * exists because a question was raised that only the client could close.
 *
 * Answers are structured rather than free text, because each one has to drive
 * arithmetic deterministically: a number of hours multiplies rates, a value
 * map merges two vocabularies. The one free-text field is appended to the
 * upload instructions and read by the planner exactly as if it had been typed
 * there in the first place.
 */

export interface IngestAnswers {
  /**
   * Paid hours in a full-time week. Set only when the client states it —
   * without it, an hourly rate is not turned into an annual cost at all.
   */
  hoursPerWeek: number | null;
  /**
   * Column label → original value → the value it should be read as. This is
   * how two files that call the same brand "Northbrook Care" and "NBC" become one
   * group rather than two.
   */
  valueMap: Record<string, Record<string, string>>;
  /** Added to the upload instructions on the next run. */
  extraContext: string;
}

export const EMPTY_ANSWERS: IngestAnswers = {
  hoursPerWeek: null,
  valueMap: {},
  extraContext: "",
};

export function hasAnswers(answers: IngestAnswers): boolean {
  return (
    answers.hoursPerWeek !== null ||
    Object.keys(answers.valueMap).length > 0 ||
    answers.extraContext.trim().length > 0
  );
}

/**
 * Reads answers back off the establishment record. Anything malformed is
 * dropped rather than thrown on: a stored answer that no longer parses should
 * cost the client a question, not the whole establishment.
 */
export function parseAnswers(json: string | null): IngestAnswers {
  if (!json) return EMPTY_ANSWERS;

  try {
    const raw: unknown = JSON.parse(json);
    if (!raw || typeof raw !== "object") return EMPTY_ANSWERS;
    const record = raw as Record<string, unknown>;

    const hours = Number(record.hoursPerWeek);

    const valueMap: Record<string, Record<string, string>> = {};
    if (record.valueMap && typeof record.valueMap === "object") {
      for (const [column, pairs] of Object.entries(record.valueMap as Record<string, unknown>)) {
        if (!pairs || typeof pairs !== "object") continue;
        const clean: Record<string, string> = {};
        for (const [from, to] of Object.entries(pairs as Record<string, unknown>)) {
          const value = String(to ?? "").trim();
          if (value) clean[from] = value;
        }
        if (Object.keys(clean).length > 0) valueMap[column] = clean;
      }
    }

    return {
      hoursPerWeek: Number.isFinite(hours) && hours > 0 ? hours : null,
      valueMap,
      extraContext: String(record.extraContext ?? "").trim(),
    };
  } catch {
    return EMPTY_ANSWERS;
  }
}

/**
 * Folds one submission from the confirm screen into whatever the client has
 * already told Atlas. Answers accumulate: correcting the brand names months
 * after supplying the paid hours must not silently drop the hours and re-zero
 * half the costs.
 */
export function mergeAnswers(existing: IngestAnswers, formData: FormData): IngestAnswers {
  const merged = parseAnswers(JSON.stringify(existing));

  const hours = Number(String(formData.get("hoursPerWeek") ?? "").trim());
  if (Number.isFinite(hours) && hours > 0) merged.hoursPerWeek = hours;

  // Value pairings arrive as map:<column>:<original value> = <the value it means>.
  for (const [field, value] of formData.entries()) {
    if (!field.startsWith("map:")) continue;
    const [, column, ...rest] = field.split(":");
    const from = rest.join(":");
    const to = String(value).trim();
    if (!column || !from) continue;

    // A pairing cleared to empty is the client saying "these are not the same
    // thing" — the value has to go back to standing on its own.
    if (!to) {
      if (merged.valueMap[column]) delete merged.valueMap[column][from];
      continue;
    }
    merged.valueMap[column] = { ...(merged.valueMap[column] ?? {}), [from]: to };
  }

  merged.extraContext = String(formData.get("extraContext") ?? "").trim();

  return merged;
}

const fold = (v: string) => v.trim().toLowerCase();

/**
 * Applies a value map to one cell, leaving anything unmapped exactly as it
 * was.
 *
 * Both the column and the value are matched loosely, because neither is
 * guaranteed to come back identical on the next run: the dimension is named
 * by the planner, which may write "Brand" one time and "brand" the next, and
 * a client's export may capitalise a brand differently in two files. An
 * answer the client has already given must survive both, or they are asked
 * the same question every time Atlas re-reads their files.
 */
export function mapValue(
  answers: IngestAnswers,
  column: string,
  value: string
): string {
  const pairs =
    answers.valueMap[column] ??
    Object.entries(answers.valueMap).find(([k]) => fold(k) === fold(column))?.[1];
  if (!pairs) return value;

  const direct = pairs[value.trim()];
  if (direct) return direct;

  return Object.entries(pairs).find(([from]) => fold(from) === fold(value))?.[1] ?? value;
}
