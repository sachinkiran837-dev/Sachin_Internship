import { formatFor, unsupportedMessage } from "./formats";
import { parseDocxFile } from "./parseDocument";
import { parseEstablishmentFile, UnsupportedFileError, type ParsedFile } from "./parseFile";
import { parseVisualFile } from "./parseVisual";

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
      return parseVisualFile(filename, buffer);
    case "document":
      return parseDocxFile(filename, buffer);
    case "table":
      return parseEstablishmentFile(filename, buffer);
  }
}
