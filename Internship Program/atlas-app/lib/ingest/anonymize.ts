/**
 * Stable pseudonym per raw name: same input always yields the same output
 * within one ingest run, so reporting lines and search stay usable without
 * ever re-exposing the real name. On by default per the ingest skill spec.
 */
export function pseudonymize(rawName: string, rowIndex: number): string {
  const trimmed = rawName.trim();
  if (!trimmed) return `Employee #${rowIndex + 1}`;

  const parts = trimmed.split(/\s+/);
  const initials = parts
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 3);

  return `${initials || "E"}-${String(rowIndex + 1).padStart(3, "0")}`;
}
