"use server";

import { revalidatePath } from "next/cache";
import { deleteOrg, getOrg } from "@/db/repo";

export interface DeleteOrgState {
  error: string | null;
}

/**
 * Deletes an establishment permanently: the positions, every derived
 * reading, the uploaded source files, and the org record itself. Confirmed
 * on the client by having the person type the establishment's own name back
 * — there is nothing to undo once this runs.
 */
export async function deleteOrgAction(
  _prevState: DeleteOrgState,
  formData: FormData
): Promise<DeleteOrgState> {
  const orgId = String(formData.get("orgId") ?? "");
  const confirmName = String(formData.get("confirmName") ?? "").trim();
  if (!orgId) return { error: "No establishment to delete." };

  const org = await getOrg(orgId);
  if (!org) return { error: "That establishment no longer exists." };

  if (confirmName !== org.name) {
    return { error: "That doesn't match the establishment's name. Nothing was deleted." };
  }

  await deleteOrg(orgId);
  revalidatePath("/");
  return { error: null };
}
