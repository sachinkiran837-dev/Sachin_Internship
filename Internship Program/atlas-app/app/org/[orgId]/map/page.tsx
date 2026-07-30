import { notFound } from "next/navigation";
import { getActiveScenario, getBaselinePositions, getBaselineRootId, getOrg } from "@/db/repo";
import { computeMetrics } from "@/lib/metrics/diagnostics";
import { buildCanonicalTable } from "@/lib/canonical/table";
import { canonicalOptions } from "@/lib/canonical/load";
import { buildFacets } from "@/lib/canonical/facets";
import { tagNodes } from "@/lib/graph/tagging";
import type { Position } from "@/lib/graph/types";
import { OrgNav } from "@/components/OrgNav";
import { EstablishmentMap } from "@/components/map/EstablishmentMap";
import { MapStats } from "@/components/map/MapStats";

export const dynamic = "force-dynamic";

export default async function MapPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const org = await getOrg(orgId);
  if (!org) notFound();

  const baseline = await getBaselinePositions(orgId);
  const rootId = getBaselineRootId(baseline);
  const scenario = await getActiveScenario(orgId);
  const positions = scenario?.positions ?? baseline;
  const version = scenario?.moves.length ?? 0;
  const metrics = computeMetrics(positions, rootId);

  // The map's filters are the canonical table's columns, built over the
  // positions actually on screen — so filtering an open scenario offers the
  // functions and brands that scenario has, not the baseline's.
  const options = await canonicalOptions(orgId);
  const table = buildCanonicalTable(positions, options.supplied, options.brandLabel);
  const facets = buildFacets(table, countFlags(positions, rootId));

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <OrgNav orgId={orgId} active="map" />
      <MapStats metrics={metrics} />
      <EstablishmentMap
        key={version}
        orgId={orgId}
        scenarioId={scenario?.id ?? null}
        positions={positions}
        rootId={rootId}
        rows={table.rows}
        facets={facets}
      />
    </div>
  );
}

/**
 * How many positions carry each diagnostic flag.
 *
 * Counted from the same tagging the map draws with, so a flag with nobody on
 * it is not offered as a filter — an "All flags / Vacant" dropdown on an
 * establishment with no vacancies is a control that can only disappoint.
 */
function countFlags(positions: Position[], rootId: string | null): Record<string, number> {
  const counts: Record<string, number> = {};
  const bump = (key: string) => (counts[key] = (counts[key] ?? 0) + 1);

  for (const n of tagNodes(positions, rootId)) {
    if (n.synthetic) continue;
    if (n.flags.protected) bump("protected");
    if (n.flags.vacant) bump("vacant");
    if (n.flags.contingent) bump("contingent");
    if (n.flags.spanHealth === "thin") bump("thin");
    if (n.flags.spanHealth === "wide") bump("wide");
    if (n.flags.singleReport) bump("singleReport");
    if (n.flags.keyPerson) bump("keyPerson");
  }

  return counts;
}
