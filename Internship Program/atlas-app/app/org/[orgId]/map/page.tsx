import { notFound } from "next/navigation";
import { getActiveScenario, getBaselinePositions, getBaselineRootId, getOrg } from "@/db/repo";
import { OrgNav } from "@/components/OrgNav";
import { EstablishmentMap } from "@/components/map/EstablishmentMap";

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

  return (
    <div className="flex flex-1 flex-col">
      <OrgNav orgId={orgId} active="map" />
      <EstablishmentMap
        key={version}
        orgId={orgId}
        scenarioId={scenario?.id ?? null}
        positions={positions}
        rootId={rootId}
      />
    </div>
  );
}
