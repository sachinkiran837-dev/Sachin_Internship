import rulesConfig from "@/config/protected-roles.json";
import type { ProtectedMatch, ProtectedRoleRule } from "@/lib/graph/types";

const RULES: ProtectedRoleRule[] = rulesConfig.rules as ProtectedRoleRule[];

/**
 * The protected-role taxonomy lives in config/protected-roles.json — an
 * editable asset, not hardcoded in a component — per the org-visualisation
 * skill spec's open decision on where this is authored.
 */
export function matchProtectedRole(title: string): ProtectedMatch | null {
  const t = title.toLowerCase();
  for (const rule of RULES) {
    if (rule.match.some((keyword) => t.includes(keyword.toLowerCase()))) {
      return {
        tier: rule.tier,
        instrument: rule.instrument,
        reason: rule.reason,
        ruleId: rule.id,
      };
    }
  }
  return null;
}

export function listProtectedRoleRules(): ProtectedRoleRule[] {
  return RULES;
}
