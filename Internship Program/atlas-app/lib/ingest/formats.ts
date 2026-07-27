/**
 * The one registry of what Atlas will accept, kept free of any parser
 * dependency so the upload form can import it into the browser without
 * dragging `xlsx` or the Anthropic SDK into the client bundle.
 *
 * `kind` decides which reader handles the file:
 * - `table`    — parsed deterministically into headers + rows (lib/ingest/parseFile).
 * - `document` — a Word file whose tables are extracted (lib/ingest/parseDocument).
 * - `visual`   — an image or PDF read by a vision model (lib/ingest/parseVisual).
 *
 * A `visual` file is the only path where a model produces the data itself
 * rather than reading a file someone else exported, so it is labelled
 * separately everywhere it surfaces — the reader has to know which rows were
 * transcribed from a picture.
 */

export type FormatKind = "table" | "document" | "visual";

export interface SupportedFormat {
  ext: string;
  label: string;
  kind: FormatKind;
}

export const SUPPORTED_FORMATS: SupportedFormat[] = [
  { ext: ".csv", label: "CSV", kind: "table" },
  { ext: ".tsv", label: "Tab-separated", kind: "table" },
  { ext: ".txt", label: "Delimited text", kind: "table" },
  { ext: ".psv", label: "Pipe-separated", kind: "table" },
  { ext: ".xlsx", label: "Excel", kind: "table" },
  { ext: ".xlsm", label: "Excel (macro)", kind: "table" },
  { ext: ".xls", label: "Excel (legacy)", kind: "table" },
  { ext: ".ods", label: "OpenDocument", kind: "table" },
  { ext: ".json", label: "JSON", kind: "table" },
  { ext: ".xml", label: "XML", kind: "table" },
  { ext: ".html", label: "HTML table", kind: "table" },
  { ext: ".htm", label: "HTML table", kind: "table" },
  { ext: ".docx", label: "Word", kind: "document" },
  { ext: ".pdf", label: "PDF", kind: "visual" },
  { ext: ".png", label: "Image", kind: "visual" },
  { ext: ".jpg", label: "Image", kind: "visual" },
  { ext: ".jpeg", label: "Image", kind: "visual" },
  { ext: ".webp", label: "Image", kind: "visual" },
  { ext: ".gif", label: "Image", kind: "visual" },
];

export function formatFor(filename: string): SupportedFormat | null {
  const lower = filename.toLowerCase();
  return SUPPORTED_FORMATS.find((f) => lower.endsWith(f.ext)) ?? null;
}

/**
 * How a file will be read, for the upload list. PDFs are the hybrid: their
 * text layer is read deterministically when they have one, and only a scan
 * or a drawn chart falls through to the model — so labelling them "read by
 * AI" outright would overstate it.
 */
export function readerLabel(filename: string): string | null {
  const format = formatFor(filename);
  if (!format || format.kind !== "visual") return null;
  return format.ext === ".pdf" ? "text layer, else AI" : "read by AI";
}

export function extensionList(): string {
  return SUPPORTED_FORMATS.map((f) => f.ext).join(", ");
}

/**
 * The refusal a person reads when their file isn't supported. It names what
 * to do instead rather than listing nineteen extensions — the full list is
 * already on the upload form, and repeating it in an error message crowds out
 * the one thing the reader needs, which is what to try next.
 */
export function unsupportedMessage(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  const named = ext.length > 1 && ext.length < 8 ? `a ${ext} file` : `"${filename}"`;
  return (
    `Atlas can't read ${named}. Upload a spreadsheet or delimited text export, JSON, XML, an HTML or Word table, ` +
    `or an image or PDF of an org chart.`
  );
}

/**
 * The most one submission can carry, enforced by the upload form before
 * anything is sent. It has to be enforced client-side because both ceilings
 * above it — Next's `serverActions.bodySizeLimit` and the host's own edge
 * limit — reject the request before any application code runs, so neither
 * failure can be explained from inside the app. An upload that is silently
 * dropped is worse than one that is refused with a reason.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * How much of a file goes in each request to /api/upload. Kept well under
 * the ~4.5MB a host will accept in one request, so the ceiling above is
 * about how much data Atlas will take rather than about HTTP.
 */
export const CHUNK_BYTES = 1024 * 1024;
