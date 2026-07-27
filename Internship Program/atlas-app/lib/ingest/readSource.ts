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
export async function readSourceFile(filename: string, buffer: Buffer): Promise<ParsedFile> {
  const format = formatFor(filename);

  if (!format) {
    throw new UnsupportedFileError(unsupportedMessage(filename));
  }

  if (buffer.byteLength === 0) {
    throw new UnsupportedFileError(`"${filename}" is empty.`);
  }

  switch (format.kind) {
    case "visual":
      return format.ext === ".pdf"
        ? readPdf(filename, buffer)
        : parseVisualFile(filename, buffer);
    case "document":
      return parseDocxFile(filename, buffer);
    case "table":
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
          `Reading a drawn chart or a scan needs the vision model, which this deployment has no ANTHROPIC_API_KEY for. ` +
          `Either set that key, or export the underlying data as CSV or Excel — the numbers behind the chart, not the picture of it.`
      );
    }

    return parseVisualFile(filename, buffer);
  }
}
