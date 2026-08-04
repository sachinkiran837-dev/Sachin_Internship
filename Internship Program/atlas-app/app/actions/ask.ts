"use server";

import { getActiveScenario, getBaselinePositions, getBaselineRootId, getBusinessContext } from "@/db/repo";
import { interpret, type AskResponse } from "@/lib/ask/interpret";

/**
 * i3-ask-atlas-interpretation's server-side half: loads the current
 * establishment (active scenario if one exists, else baseline — same rule
 * every other page follows) and hands the query to the interpreter. Keyword
 * matching runs first and answers most queries with no AI call at all; see
 * lib/ask/interpret.ts's own doc comment for when and how it escalates.
 */
export async function askAction(orgId: string, _prev: AskResponse | null, formData: FormData): Promise<AskResponse> {
  const query = String(formData.get("query") ?? "");

  const baseline = await getBaselinePositions(orgId);
  const rootId = getBaselineRootId(baseline);
  const scenario = await getActiveScenario(orgId);
  const positions = scenario?.positions ?? baseline;
  const business = await getBusinessContext(orgId);

  return await interpret(query, positions, rootId, business);
}
