import { CHUNK_BYTES } from "./formats";

/**
 * Sends a file to /api/upload in pieces and returns the id it was staged
 * under, which the ingest action then reassembles from.
 *
 * The reason this exists rather than putting the file straight in the form:
 * a host rejects any single request over a few megabytes at its edge, before
 * application code runs, so an oversized upload fails with nothing rendered
 * and nothing logged. Splitting the file across several small requests moves
 * the ceiling from "what one HTTP request can carry" to "what Atlas is
 * willing to accept", which is a limit the app can actually enforce and
 * explain.
 */
export async function uploadFileInChunks(
  file: File,
  onProgress?: (sentBytes: number) => void
): Promise<string> {
  const uploadId = crypto.randomUUID();
  const chunkCount = Math.max(1, Math.ceil(file.size / CHUNK_BYTES));

  for (let index = 0; index < chunkCount; index++) {
    const start = index * CHUNK_BYTES;
    const blob = file.slice(start, Math.min(start + CHUNK_BYTES, file.size));

    const body = new FormData();
    body.set("uploadId", uploadId);
    body.set("filename", file.name);
    body.set("chunkIndex", String(index));
    body.set("chunkCount", String(chunkCount));
    body.set("chunk", blob);

    const response = await fetch("/api/upload", { method: "POST", body });
    if (!response.ok) {
      // Named so the caller can say which file failed, rather than failing
      // the whole batch anonymously.
      throw new Error(
        `"${file.name}" could not be uploaded (${response.status}). Check your connection and try again.`
      );
    }

    onProgress?.(start + blob.size);
  }

  return uploadId;
}
