import { ask, hasAI } from "@/lib/ai/client";
import { formatFor } from "./formats";
import { UnsupportedFileError, type ParsedFile } from "./parseFile";

/**
 * Reads an org chart out of a picture — a screenshot, a photo of a printed
 * structure chart, a PDF of the board pack — and returns the same headers +
 * rows shape every other reader produces, so nothing downstream needs to know
 * where the table came from.
 *
 * This is the one place in the app where a model *produces* data rather than
 * reading a file someone else exported, which makes it the one place the
 * "model is the reader and the drafter, never the calculator" rule needs
 * stating explicitly: the model transcribes what is drawn and nothing else.
 * Every row it returns is marked for review (`conversion.needsReview`), and
 * the confirm screen raises each visual file as a low-confidence ingest issue.
 * A transcribed chart is a starting point for a conversation with the client,
 * not a baseline to model savings off unchecked.
 *
 * Without an AI key there is no deterministic fallback that could
 * honestly read a picture, so the file is refused with a reason rather than
 * half-read — the visible-fallback pattern applied to a behaviour that has no
 * fallback.
 */

/** Header names chosen to match the column mapper's existing synonyms. */
const EXTRACTION_COLUMNS = [
  "Position ID",
  "Employee Name",
  "Position Title",
  "Department",
  "Manager Name",
  "Fully Loaded Cost",
  "FTE",
  "Status",
] as const;

const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** The API's own per-file ceiling for base64 image and document blocks. */
const MAX_VISUAL_BYTES = 5 * 1024 * 1024;

const SYSTEM_PROMPT = `You transcribe organisation charts and staff lists into tabular data.

Return ONLY a JSON array of objects. No prose before or after it, no markdown code fences. Each object uses exactly these keys:
${EXTRACTION_COLUMNS.map((c) => `"${c}"`).join(", ")}

Rules, in order of importance:
1. Transcribe only what is visibly present. Never invent a person, title, department, cost or reporting line. If a value is not shown, use an empty string.
2. "Manager Name" is the name of the person this role reports to, read from the connecting lines of the chart. The most senior role has an empty "Manager Name".
3. If names are not shown but titles are, leave "Employee Name" empty and still fill "Position Title" — a chart of titles alone is still useful.
4. Copy costs and FTE exactly as printed, including currency symbols. Do not convert, annualise or estimate them.
5. Include every box on the chart, including vacant ones. If a box is marked vacant, put "vacant" in "Status".
6. If the image contains no organisational structure or staff list at all, return an empty array [].`;

interface VisualExtraction {
  rows: Record<string, string>[];
}

export function isVisualFile(filename: string): boolean {
  return formatFor(filename)?.kind === "visual";
}

export async function parseVisualFile(filename: string, buffer: Buffer): Promise<ParsedFile> {
  const format = formatFor(filename);
  if (!format || format.kind !== "visual") {
    throw new UnsupportedFileError(`"${filename}" is not an image or PDF.`);
  }

  if (!hasAI()) {
    throw new UnsupportedFileError(
      `Atlas reads org charts out of images and PDFs with a vision model, and no AI key is configured on this deployment, ` +
        `so "${filename}" could not be read. Everything else about Atlas works without it — but a picture has no deterministic fallback. ` +
        `Either set OPENAI_API_KEY or ANTHROPIC_API_KEY, or export the chart from its source system as CSV or Excel.`
    );
  }

  if (buffer.byteLength > MAX_VISUAL_BYTES) {
    throw new UnsupportedFileError(
      `"${filename}" is ${(buffer.byteLength / (1024 * 1024)).toFixed(1)}MB, over the 5MB limit for a single image or PDF. ` +
        `Split it into pages, or reduce the resolution.`
    );
  }

  const { rows } = await extract(filename, buffer, format.ext);

  if (rows.length === 0) {
    throw new UnsupportedFileError(
      `Atlas looked at "${filename}" and could not find an organisation chart or staff list in it. ` +
        `If there is one, it may be too low-resolution to read — try a larger or sharper image.`
    );
  }

  // Only keep columns the chart actually populated, so an image with no
  // costs on it doesn't present an empty cost column as though it were data.
  const headers = EXTRACTION_COLUMNS.filter((c) => rows.some((r) => (r[c] ?? "").trim() !== ""));

  const normalised = rows.map((row) => {
    const out: Record<string, string> = {};
    for (const h of headers) out[h] = (row[h] ?? "").trim();
    return out;
  });

  const noun = format.ext === ".pdf" ? "PDF" : "image";

  return {
    headers: [...headers],
    rows: normalised,
    conversion: {
      sourceFormat: format.label,
      detail:
        `Read directly from the ${noun}: ${normalised.length} position${normalised.length === 1 ? "" : "s"} transcribed ` +
        `into ${headers.length} column${headers.length === 1 ? "" : "s"}.`,
      rowCount: normalised.length,
      needsReview:
        `Every row from "${filename}" was transcribed from a ${noun} rather than exported from a system. ` +
        `Check the names, reporting lines and any figures against the source before treating this as a baseline.`,
    },
  };
}

async function extract(filename: string, buffer: Buffer, ext: string): Promise<VisualExtraction> {
  const answer = await ask({
    maxTokens: 16000,
    system: SYSTEM_PROMPT,
    media: {
      kind: ext === ".pdf" ? "pdf" : "image",
      mediaType: MEDIA_TYPES[ext] ?? "image/png",
      base64: buffer.toString("base64"),
    },
    prompt: `Transcribe every role shown in this file ("${filename}") into the JSON array described in your instructions.`,
  });

  // A chart bigger than one pass can hold comes back cut off mid-array, and
  // by the time it reaches the parser it is indistinguishable from a model
  // that simply got it wrong. Said plainly here, because the two call for
  // completely different things from the person who uploaded it.
  if (answer.truncated) {
    throw new UnsupportedFileError(
      `"${filename}" holds more roles than Atlas can transcribe in one pass, so the reading stopped part-way ` +
        `and none of it was used rather than the half that arrived. Split it into one image per division and ` +
        `upload them together.`
    );
  }

  return { rows: parseRows(answer.text, filename) };
}

function parseRows(raw: string, filename: string): Record<string, string>[] {
  // Takes the array out of whatever the model wrapped it in. Prefilling an
  // opening bracket would make a preamble impossible, but current models
  // reject a conversation that ends on an assistant message, so the wrapper
  // is stripped here instead. A missing closing bracket means the response
  // was truncated mid-chart, which falls through to the refusal below.
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  const candidate = start === -1 || end <= start ? raw : raw.slice(start, end + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new UnsupportedFileError(
      `Atlas read "${filename}" but could not turn the result into a table — the chart may be larger than a single pass can transcribe. ` +
        `Try splitting it into one image per division.`
    );
  }

  if (!Array.isArray(parsed)) {
    throw new UnsupportedFileError(`Atlas could not read a list of positions out of "${filename}".`);
  }

  return parsed
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object" && !Array.isArray(r))
    .map((r) => {
      const row: Record<string, string> = {};
      for (const column of EXTRACTION_COLUMNS) {
        const value = r[column];
        row[column] = value === null || value === undefined ? "" : String(value);
      }
      return row;
    })
    // A row with neither a title nor a name is an artefact of the read, not a role.
    .filter((r) => r["Position Title"].trim() !== "" || r["Employee Name"].trim() !== "");
}
