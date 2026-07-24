import type { ColumnMapping } from "@/lib/graph/types";

/**
 * Synonym lists for the columns that show up across the common HR export
 * shapes (Workday, SAP SuccessFactors, BambooHR, a bare CSV export). Anything
 * that doesn't match a synonym is still surfaced to the human as an
 * unmapped column rather than silently dropped.
 */
const SYNONYMS = {
  name: ["name", "employee name", "full name", "worker", "employee"],
  title: ["title", "position title", "job title", "role", "position"],
  department: [
    "department",
    "division",
    "function",
    "business unit",
    "cost centre",
    "cost center",
    "team",
  ],
  managerName: [
    "manager",
    "manager name",
    "reports to",
    "supervisor",
    "manager id",
    "reporting manager",
  ],
  positionId: ["position id", "id", "employee id", "position number", "role id"],
  cost: ["cost", "salary", "fully loaded cost", "annual cost", "compensation", "flc"],
  fte: ["fte", "full time equivalent"],
  status: ["status", "position status", "employment status"],
} satisfies Record<string, string[]>;

function normalize(header: string): string {
  return header.trim().toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ");
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
