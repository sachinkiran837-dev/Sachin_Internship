import { getOrg } from "@/db/repo";
import { loadCanonicalTable } from "@/lib/canonical/load";
import { toCsv } from "@/lib/canonical/table";

/**
 * The clean table as a file.
 *
 * Generated on request rather than written at ingest, so it is always the
 * establishment as it stands now — after every correction, every re-read and
 * every answered question. A file written once at ingest would be a second
 * copy of the truth that quietly stops matching the first.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const org = await getOrg(orgId);
  if (!org) return new Response("Not found", { status: 404 });

  const csv = toCsv(await loadCanonicalTable(orgId));
  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = org.name.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "establishment";

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName} — canonical ${stamp}.csv"`,
      // The establishment changes whenever a question is answered, so a
      // cached copy is a wrong copy.
      "Cache-Control": "no-store",
    },
  });
}
