/**
 * Normalizes a title down to the underlying role, stripping the hire-type
 * prefix/suffix an export often carries — "Agency Registered Nurse" and
 * "Registered Nurse (Contract)" both key to "registered nurse", so a
 * contingent role can be benchmarked against its permanent equivalent (or,
 * per A3, against the classification median of positions holding the same
 * underlying role). Shared between the scenario plays and the cost-estimate
 * fallback so the two never drift into disagreeing about what counts as "the
 * same role".
 */
const CONTINGENT_PREFIXES = /^(agency|contract|contractor|locum|temp|temporary|casual|interim)\s+/i;
const CONTINGENT_SUFFIXES = /\s+\((agency|contract|locum|temp|casual)\)$/i;

export function baseTitle(title: string): string {
  return title.replace(CONTINGENT_PREFIXES, "").replace(CONTINGENT_SUFFIXES, "").trim().toLowerCase();
}

/** Same strip, case preserved — for display rather than as a comparison key. */
export function stripHireTypePrefix(title: string): string {
  return title.replace(CONTINGENT_PREFIXES, "");
}
