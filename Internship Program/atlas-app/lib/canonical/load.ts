import { getBaselinePositions, getIngestPlan, getSourceFiles } from "@/db/repo";
import { buildCanonicalTable, type CanonicalTable, type SuppliedFields } from "./table";

/**
 * The canonical table for an establishment, assembled from what is stored.
 *
 * Shared by the screen and the CSV route so the file someone downloads and
 * the table they were looking at cannot differ — two builders reading the
 * same database would drift the first time one of them was changed.
 *
 * Which fields the source files actually supplied is read from the per-file
 * bindings rather than guessed from the result: a column of blanks and a
 * column that never existed produce the same empty cells, and only one of
 * them is worth going back to the client about.
 */
export async function loadCanonicalTable(orgId: string): Promise<CanonicalTable> {
  const [positions, options] = await Promise.all([
    getBaselinePositions(orgId),
    canonicalOptions(orgId),
  ]);

  return buildCanonicalTable(positions, options.supplied, options.brandLabel);
}

/**
 * How to build the canonical table for an establishment, without deciding
 * which positions to build it from.
 *
 * Split out because the map shows either the baseline or an open scenario, and
 * its filters are the canonical table's columns — so it has to build the table
 * over the positions on screen. Sharing this rather than repeating it is what
 * keeps the map's Function list and the table's Function column the same list.
 */
export async function canonicalOptions(
  orgId: string
): Promise<{ supplied: SuppliedFields; brandLabel: string }> {
  const [files, plan] = await Promise.all([getSourceFiles(orgId), getIngestPlan(orgId)]);

  const contributed = new Set(files.flatMap((f) => f.contributedFields));
  const supplied: SuppliedFields = {
    fte: contributed.has("fte"),
    status: contributed.has("status"),
    cost: contributed.has("cost"),
    department: contributed.has("department"),
    manager: contributed.has("managerName"),
  };

  // Named the way the client's own instructions named it — "brand", "entity",
  // "region" — so the column heading is a word they use.
  const label = plan?.groupBy?.label;
  const brandLabel = label ? label.charAt(0).toUpperCase() + label.slice(1) : "Brand";

  return { supplied, brandLabel };
}
