import rulesConfig from "@/config/protected-roles.json";
import type { ProtectedMatch, ProtectedRoleRule, ProtectedTier } from "@/lib/graph/types";

const RULES: ProtectedRoleRule[] = rulesConfig.rules as ProtectedRoleRule[];
const TIER_ORDER = rulesConfig._tierOrder as ProtectedTier[];

/** E1: a manager auto-held for staffing a clinical/frontline roster (A2), regardless of title match. */
export const AUTO_HOLD_ROSTER_RULE_ID = "auto-hold-roster-lead";

const AUTO_HOLD_ROSTER_MATCH: ProtectedMatch = {
  tier: "safety",
  instrument: "Roster/rostered-service continuity (A2 auto-hold)",
  reason:
    "Leads a rostered clinical or frontline service of at least the roster threshold — held automatically because removing this role's leadership is a continuity-of-care risk regardless of what the title matches.",
  ruleId: AUTO_HOLD_ROSTER_RULE_ID,
};

/**
 * The protected-role taxonomy lives in config/protected-roles.json — an
 * editable asset, not hardcoded in a component — per the org-visualisation
 * skill spec's open decision on where this is authored.
 *
 * A role can match more than one rule (a "Chief Financial Officer" who is
 * also the public officer, say) at different tiers — every match is
 * collected and the highest tier per `_tierOrder` wins, rather than
 * whichever rule happened to be listed first.
 */
export function matchProtectedRole(title: string, isUnitRoster = false): ProtectedMatch | null {
  const t = title.toLowerCase();
  const matches: ProtectedMatch[] = RULES.filter((rule) =>
    rule.match.some((keyword) => t.includes(keyword.toLowerCase()))
  ).map((rule) => ({ tier: rule.tier, instrument: rule.instrument, reason: rule.reason, ruleId: rule.id }));

  if (isUnitRoster) matches.push(AUTO_HOLD_ROSTER_MATCH);
  if (matches.length === 0) return null;

  return matches.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier))[0];
}

export function listProtectedRoleRules(): ProtectedRoleRule[] {
  return RULES;
}

/**
 * E1 step 5: a mandated role the register expects but the graph does not
 * actually contain — a finding in its own right, not a null result. A rule
 * belongs in this engagement's register (it was configured for this
 * client's jurisdiction and sector) and zero positions anywhere match it.
 */
export function findControlGaps(titles: string[]): ProtectedRoleRule[] {
  const lowered = titles.map((t) => t.toLowerCase());
  return RULES.filter(
    (rule) => !rule.match.some((keyword) => lowered.some((t) => t.includes(keyword.toLowerCase())))
  );
}
