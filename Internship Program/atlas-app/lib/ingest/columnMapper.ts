import type { ColumnMapping } from "@/lib/graph/types";

/**
 * Synonym lists for the columns that show up across the common HR export
 * shapes (Workday, SAP SuccessFactors, BambooHR, a bare CSV export). Anything
 * that doesn't match a synonym is still surfaced to the human as an
 * unmapped column rather than silently dropped.
 */
const SYNONYMS = {
  name: ["name", "employee name", "full name", "worker", "employee", "person", "incumbent"],
  title: ["title", "position title", "job title", "role", "position", "job", "designation"],
  department: [
    "department",
    "division",
    "function",
    "business unit",
    "cost centre",
    "cost center",
    "team",
    "directorate",
    "service",
  ],
  managerName: [
    "manager",
    "manager name",
    "reports to",
    "supervisor",
    "manager id",
    "reporting manager",
    "line manager",
    "parent",
    "reports to id",
    "supervisor id",
  ],
  positionId: ["position id", "id", "employee id", "position number", "role id", "staff id"],
  cost: [
    "cost",
    "salary",
    "fully loaded cost",
    "annual cost",
    "compensation",
    "flc",
    "remuneration",
    "package",
  ],
  fte: ["fte", "full time equivalent"],
  status: ["status", "position status", "employment status", "employment type"],
} satisfies Record<string, string[]>;

/**
 * Headers arrive in whatever shape the source used. A CSV gives
 * "Manager ID"; the same field out of a JSON API is "reportsTo", and out of
 * a nested payload it's "manager.id" — all three have to land on the same
 * canonical field, so casing, separators and dotted paths are flattened to
 * one spaced lower-case form before matching.
 */
function normalize(header: string): string {
  return header
    .trim()
    // Split camelCase / PascalCase into words: reportsTo -> reports To.
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function mapColumns(headers: string[]): ColumnMapping[] {
  const used = new Set<string>();
  return headers.map((sourceColumn) => {
    const normalized = normalize(sourceColumn);
    let bestField: keyof typeof SYNONYMS | null = null;
    let bestScore = 0;

    for (const [field, synonyms] of Object.entries(SYNONYMS)) {
      if (used.has(field)) continue;
      for (const syn of synonyms) {
        if (normalized === syn) {
          bestField = field as keyof typeof SYNONYMS;
          bestScore = 1;
          break;
        }
        if (normalized.includes(syn) && syn.length > 2) {
          const score = syn.length / normalized.length;
          if (score > bestScore) {
            bestField = field as keyof typeof SYNONYMS;
            bestScore = score;
          }
        }
      }
      if (bestScore === 1) break;
    }

    if (bestField) used.add(bestField);

    return {
      sourceColumn,
      targetField: bestField,
      confidence: bestField ? Math.max(bestScore, 0.6) : 0,
      autoMapped: bestScore >= 0.95,
    };
  });
}
