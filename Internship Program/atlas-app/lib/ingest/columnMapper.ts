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
    const { field, score } = bestMatch(normalize(sourceColumn));

    // A column maps to the field it most resembles, or to nothing. It is
    // never handed to its *second* choice because the first was taken: an
    // establishment with both "Department" and "Cost Centre" would otherwise
    // see the latter lose department, fall through to the "cost" synonym,
    // and quietly become everyone's salary — after which the real payroll
    // figures arrive, disagree, and are discarded as conflicts. An unmapped
    // extra column is recoverable; a poisoned cost field is not.
    const claimed = field !== null && !used.has(field);
    if (claimed) used.add(field);

    return {
      sourceColumn,
      targetField: claimed ? field : null,
      confidence: claimed ? Math.max(score, 0.6) : 0,
      autoMapped: claimed && score >= 0.95,
    };
  });
}

/** The single best field for a header, ignoring what has already been taken. */
function bestMatch(normalized: string): { field: keyof typeof SYNONYMS | null; score: number } {
  let field: keyof typeof SYNONYMS | null = null;
  let score = 0;

  for (const [candidate, synonyms] of Object.entries(SYNONYMS)) {
    for (const syn of synonyms) {
      if (normalized === syn) return { field: candidate as keyof typeof SYNONYMS, score: 1 };

      if (normalized.includes(syn) && syn.length > 2) {
        const candidateScore = syn.length / normalized.length;
        if (candidateScore > score) {
          score = candidateScore;
          field = candidate as keyof typeof SYNONYMS;
        }
      }
    }
  }

  return { field, score };
}
