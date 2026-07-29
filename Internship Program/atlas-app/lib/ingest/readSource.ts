import { composeColumns } from "./composeColumns";
import { EMPTY_ANSWERS, type IngestAnswers } from "./answers";
import { formatFor, unsupportedMessage } from "./formats";
import { parseDocxFile } from "./parseDocument";
import { parseEstablishmentFile, UnsupportedFileError, type ParsedFile } from "./parseFile";
import { isPdfNoTable, parsePdfFile } from "./parsePdf";
import { parseVisualFile } from "./parseVisual";
import { hasAI } from "@/lib/ai/client";

/**
 * The one entry point for turning an uploaded file of any supported kind into
 * the headers + rows shape the rest of the pipeline reads. Everything above
 * this line (the ingest action, the verification scripts) works in one shape
 * regardless of whether the source was a spreadsheet, a Word table or a photo
 * of a whiteboard.
 */
export async function readSourceFile(
  filename: string,
  buffer: Buffer,
  /**
   * What the client has already told Atlas about their own data, from an
   * earlier run of this same establishment. Only ever *adds* what the file
   * couldn't say for itself — a paid-hours figure that lets an hourly rate
   * become a cost. With no answers, the file is read on its own evidence and
   * whatever that leaves open is raised as a question rather than filled in.
   */
  answers: IngestAnswers = EMPTY_ANSWERS
): Promise<ParsedFile> {
  const format = formatFor(filename);

  if (!format) {
    throw new UnsupportedFileError(unsupportedMessage(filename));
  }

  if (buffer.byteLength === 0) {
    throw new UnsupportedFileError(`"${filename}" is empty.`);
  }

  const parsed = await read(format.kind, format.ext, filename, buffer);

  // Columns an establishment needs but a payroll export doesn't have — a
  // whole name where the file holds a first and a last, an annual cost where
  // it holds an hourly rate — are built here, once, so every reader benefits
  // and nothing downstream has to know they were built.
  return composeColumns(parsed, answers, filename);
}

function read(
  kind: string,
  ext: string,
  filename: string,
  buffer: Buffer
): Promise<ParsedFile> | ParsedFile {
  switch (kind) {
    case "visual":
      return ext === ".pdf" ? readPdf(filename, buffer) : parseVisualFile(filename, buffer);
    case "document":
      return parseDocxFile(filename, buffer);
    default:
      return parseEstablishmentFile(filename, buffer);
  }
}

/**
 * A PDF gets the deterministic reader first. Most PDFs holding establishment
 * data were exported from something that already had it as text — Word,
 * Excel, a report writer — and that text is still in the file with the
 * coordinates it was drawn at, so the table can be rebuilt by arithmetic. No
 * key, no model, no inference, and it works on a deployment with no AI
 * configured at all.
 *
 * Only when there is no table to prove — a scan, or a chart drawn as boxes
 * and connector lines — does it fall back to the vision reader, and the
 * refusal when that isn't configured says which of the two situations it hit.
 * The distinction matters: "this PDF is a picture" and "Atlas can't read
 * PDFs" call for completely different things from the person uploading.
 */
async function readPdf(filename: string, buffer: Buffer): Promise<ParsedFile> {
  try {
    return parsePdfFile(filename, buffer);
  } catch (err) {
    if (!isPdfNoTable(err)) throw err;

    if (!hasAI()) {
      throw new UnsupportedFileError(
        `${(err as Error).message} Atlas read the file itself rather than refusing it, and there was no table in it to take. ` +
          `Reading a drawn chart or a scan needs a vision model, and this deployment has no AI key set. ` +
          `Either set OPENAI_API_KEY or ANTHROPIC_API_KEY, or export the underlying data as CSV or Excel — the numbers behind the chart, not the picture of it.`
      );
    }

    return parseVisualFile(filename, buffer);
  }
}
