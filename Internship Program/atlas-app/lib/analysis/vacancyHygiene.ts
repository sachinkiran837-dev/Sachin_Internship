import vacancyConfig from "@/config/vacancy-hygiene.json";
import relianceBands from "@/config/contingent-reliance-bands.json";
import { tagNodes } from "@/lib/graph/tagging";
import { daysSince } from "@/lib/ingest/parseDate";
import type { LayoutNode, Position } from "@/lib/graph/types";

/**
 * d2-vacancy-establishment-hygiene: what a vacancy is actually saying about
 * the establishment — a recruitment failure, a latent saving, a roster gap
 * papered over by agency at a premium, or a control gap that isn't a
 * removal candidate at all.
 *
 * Deliberately takes no dependency on D1's own module: the agency overlay it
 * needs is a per-function agency share, which `analyseFunctions` already
 * computes (`UnitProfile.agencyShare`) — reusing that keeps this a one-way
 * dependency (D1 reads D2's output for its own overlay direction, not the
 * other way around).
 */

const LONG_VACANT_THRESHOLD_DAYS = vacancyConfig.longVacantThresholdDays;
const STRUCTURAL_AGENCY_THRESHOLD = relianceBands.structuralThreshold;

export type VacancyReading = "recruitment-failure" | "latent-saving" | "agency-papered-gap" | "control-gap";

export interface LongVacantPosition {
  id: string;
  title: string;
  functionGroup: string;
  ageDays: number | null;
  cost: number;
  reading: VacancyReading | "not enough data";
}

export interface UnitVacancy {
  functionGroup: string;
  headcount: number;
  vacantCount: number;
  vacancyRate: number;
  fundedVacantCost: number;
}

export interface VacancyHygieneResult {
  headcount: number;
  vacantCount: number;
  vacancyRate: number;
  fundedVacantCost: number;
  byUnit: UnitVacancy[];
  /** Vacancies confirmed past the long-vacant threshold — excludes vacancies of unknown age, which are never asserted long. */
  longVacant: LongVacantPosition[];
  /** Vacant positions with no vacancy date to age from — their status is real, their age isn't computable. */
  ageUnknownCount: number;
  /** False when no position anywhere in the establishment carries a vacancy date — aging and reading are then not computable at all. */
  agingComputable: boolean;
}

function unitVacancy(functionGroup: string, members: LayoutNode[]): UnitVacancy {
  const vacant = members.filter((n) => n.status === "vacant");
  return {
    functionGroup,
    headcount: members.length,
    vacantCount: vacant.length,
    vacancyRate: members.length === 0 ? 0 : vacant.length / members.length,
    fundedVacantCost: vacant.reduce((s, n) => s + n.cost * n.fte, 0),
  };
}

function proposeReading(
  node: LayoutNode,
  ageDays: number | null,
  agencyShare: number | undefined
): VacancyReading | "not enough data" {
  // A funded-vacant protected role is a control gap, not a quick-win removal
  // candidate — this call outranks the others regardless of age or overlay.
  if (node.flags.protected) return "control-gap";
  if (ageDays === null) return "not enough data";
  if (agencyShare !== undefined && agencyShare >= STRUCTURAL_AGENCY_THRESHOLD) return "agency-papered-gap";
  if (ageDays >= LONG_VACANT_THRESHOLD_DAYS * 2) return "latent-saving";
  return "recruitment-failure";
}

export function buildVacancyHygiene(
  positions: Position[],
  rootId: string | null,
  agencyShareByUnit: Map<string, number> = new Map()
): VacancyHygieneResult {
  const tagged = tagNodes(positions, rootId);
  const real = tagged.filter((n) => !n.synthetic);
  const vacant = real.filter((n) => n.status === "vacant");

  const byFunction = new Map<string, LayoutNode[]>();
  for (const n of real) {
    byFunction.set(n.functionGroup, [...(byFunction.get(n.functionGroup) ?? []), n]);
  }
  const byUnit = [...byFunction.entries()]
    .map(([fn, members]) => unitVacancy(fn, members))
    .sort((a, b) => b.vacancyRate - a.vacancyRate);

  const agingComputable = vacant.some((n) => n.vacantSince !== null);

  const aged = vacant.map((n) => {
    const ageDays = daysSince(n.vacantSince);
    return {
      id: n.id,
      title: n.title,
      functionGroup: n.functionGroup,
      ageDays,
      cost: n.cost * n.fte,
      reading: proposeReading(n, ageDays, agencyShareByUnit.get(n.functionGroup)),
    };
  });

  const longVacant = aged
    .filter((v): v is LongVacantPosition & { ageDays: number } => v.ageDays !== null && v.ageDays >= LONG_VACANT_THRESHOLD_DAYS)
    .sort((a, b) => b.ageDays - a.ageDays);

  return {
    headcount: real.length,
    vacantCount: vacant.length,
    vacancyRate: real.length === 0 ? 0 : vacant.length / real.length,
    fundedVacantCost: vacant.reduce((s, n) => s + n.cost * n.fte, 0),
    byUnit,
    longVacant,
    ageUnknownCount: aged.filter((v) => v.ageDays === null).length,
    agingComputable,
  };
}

export const VACANCY_METHOD =
  `A vacancy is flagged "long-vacant" past ${LONG_VACANT_THRESHOLD_DAYS} days — an engagement-configurable default, ` +
  `not a universal one. A funded-vacant protected role always reads as a control gap, never a removal candidate. ` +
  `Every other reading is a proposal for confirmation, not an assertion.`;
