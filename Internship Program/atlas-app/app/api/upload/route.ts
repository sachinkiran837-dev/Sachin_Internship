import { NextResponse } from "next/server";
import { purgeStaleUploads, saveUploadChunk } from "@/db/repo";
import { CHUNK_BYTES, MAX_UPLOAD_BYTES } from "@/lib/ingest/formats";

/**
 * Receives one piece of one file.
 *
 * A Server Action can only carry as much as the host will let through in a
 * single request — Vercel rejects anything over ~4.5MB at its edge, before
 * application code runs, which is why that failure can never be reported
 * from inside the app. So the browser slices each file into chunks small
 * enough to be uncontroversial, posts them here one request at a time, and
 * the ingest action reassembles them. The upload ceiling then depends on
 * what Atlas is willing to hold, not on what one HTTP request can carry.
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Malformed upload." }, { status: 400 });
  }

  const uploadId = String(form.get("uploadId") ?? "");
  const filename = String(form.get("filename") ?? "");
  const chunkIndex = Number(form.get("chunkIndex"));
  const chunkCount = Number(form.get("chunkCount"));
  const chunk = form.get("chunk");

  if (
    !uploadId ||
    !filename ||
    !Number.isInteger(chunkIndex) ||
    !Number.isInteger(chunkCount) ||
    chunkCount < 1 ||
    chunkIndex < 0 ||
    chunkIndex >= chunkCount ||
    !(chunk instanceof Blob)
  ) {
    return NextResponse.json({ error: "Malformed upload." }, { status: 400 });
  }

  // Bound what one upload can claim regardless of what the client says, so a
  // hand-crafted request can't stage an unbounded amount of data.
  if (chunkCount * CHUNK_BYTES > MAX_UPLOAD_BYTES * 2 || chunk.size > CHUNK_BYTES * 2) {
    return NextResponse.json({ error: "Upload too large." }, { status: 413 });
  }

  if (chunkIndex === 0) await purgeStaleUploads();

  await saveUploadChunk({
    uploadId,
    filename,
    chunkIndex,
    chunkCount,
    data: Buffer.from(await chunk.arrayBuffer()).toString("base64"),
  });

  return NextResponse.json({ ok: true, chunkIndex });
}
