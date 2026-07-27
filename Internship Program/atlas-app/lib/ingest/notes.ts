/**
 * The register of everything Atlas could not read straight off the data.
 *
 * Two things end up here, and the difference between them is the whole point:
 *
 * - an **assumption** is a reading Atlas made and applied. It changed the
 *   numbers. It has to be visible before anyone looks at a map built on it.
 * - a **question** is a reading Atlas refused to make. Nothing was invented,
 *   so something is missing — an uncosted population, an unreconciled pair of
 *   vocabularies — and the client is the only one who can close it.
 *
 * Both are shown on the confirm screen, between the ingest and the map, which
 * is the last moment before a figure starts being treated as fact. A question
 * carries an `answerKind`, and answering it re-runs the ingest with the answer
 * applied — at which point the same note comes back as an assumption that
 * names the client as its source.
 *
 * Nothing in this file holds a default. A note exists precisely because there
 * wasn't one.
 */

export type NoteKind = "assumption" | "question";

/** What kind of answer would close a question, and therefore what input to draw. */
export type AnswerKind =
  /** A number of paid hours in a full-time week. */
  | "hours"
  /** A value-by-value reconciliation of two vocabularies. */
  | "mapping"
  /** Nothing to fill in — the note is there to be read. */
  | "none";

/** One value from the data and what the client says it should be read as. */
export interface NoteOption {
  from: string;
  to: string;
  /** Where the value came from, so the pairing can be judged. */
  seenIn: string;
}

export interface IngestNote {
  /** Stable across re-ingests, so an answer can be attached to the same question. */
  id: string;
  kind: NoteKind;
  /** Short heading — "Paid hours", "Brand names", "Chart coverage". */
  topic: string;
  /** What Atlas did, or what it needs. One sentence, addressed to the client. */
  statement: string;
  /** What in the data caused it. Always specific: counts, columns, values. */
  evidence: string;
  /** What moves if this is wrong, or what would change on being answered. */
  effect: string;
  answerKind: AnswerKind;
  /** For a mapping question: the values needing a decision, with Atlas's proposal. */
  options: NoteOption[];
  /** Set when the note exists because the client already answered it. */
  answeredWith?: string;
}

/** Builds a note with the fields that are nearly always the same filled in. */
export function note(
  id: string,
  kind: NoteKind,
  fields: Omit<IngestNote, "id" | "kind" | "answerKind" | "options"> &
    Partial<Pick<IngestNote, "answerKind" | "options">>
): IngestNote {
  return {
    id,
    kind,
    answerKind: "none",
    options: [],
    ...fields,
  };
}

/** Notes the client still has to act on, most consequential first. */
export function openQuestions(notes: IngestNote[]): IngestNote[] {
  return notes.filter((n) => n.kind === "question");
}

export function assumptions(notes: IngestNote[]): IngestNote[] {
  return notes.filter((n) => n.kind === "assumption");
}
