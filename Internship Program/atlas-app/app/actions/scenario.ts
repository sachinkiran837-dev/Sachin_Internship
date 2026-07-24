"use server";

import { redirect } from "next/navigation";
import { createNamedScenario } from "@/db/repo";

export async function createScenarioAction(orgId: string, formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim() || "Untitled scenario";
  const scenario = await createNamedScenario(orgId, name);
  redirect(`/org/${orgId}/scenarios/${scenario.id}`);
}
