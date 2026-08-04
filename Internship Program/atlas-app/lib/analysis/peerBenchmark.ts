import layerBandConfig from "@/config/layer-bands.json";
import contingentBandConfig from "@/config/contingent-reliance-bands.json";
import peerBandsConfig from "@/config/peer-bands.json";
import { tagNodes } from "@/lib/graph/tagging";
import { isPublicHealthSector } from "@/lib/analysis/backOfficeBenchmarks";
import type { UnitComparison } from "@/lib/analysis/functions";
import type { ContingentRelianceResult } from "@/lib/analysis/contingentReliance";
import type { DiagnosticMetrics, Position } from "@/lib/graph/types";
import type { BusinessContext } from "@/lib/hypothesis/context";

/**
 * f1-peer-benchmarking: the one comparison in Atlas that reads outward
 * rather than at the organisation's own median — layers, spans, contingent
 * reliance, management overhead and corporate cost share against a peer
 * cohort, in bands, never a point estimate.
 *
 * Every comparator metric is sourced from the skill that owns it (layers and
 * spans from the diagnostic engine, management overhead from b4's own
 * manager-cost figure, contingent share from d1's own verdict, corporate
 * cost share from the self-relative function comparison) rather than
 * recomputed here — this module's own job is exactly steps 3-5 of the skill
 * spec: pick the cohort, apply the band, get the denominator right.
 *
 * Atlas has one calibrated cohort today (mid-size, 100-2,000 headcount) —
 * layers and contingent share reuse the exact constants already stated in
 * layer-bands.json and contingent-reliance-bands.json (the skill spec's own
 * worked example cites those same figures), and management overhead adds the
 * one genuinely new number the spec gives (10-13%). An organisation outside
 * that headcount range still gets a read against the only band Atlas has,
 * but it is marked provisional rather than presented as calibrated for its
 * size — the skill's own edge-case rule, not a silent extrapolation.
 */

interface SizeBandConfig {
  maxHeadcount?: number;
  label: string;
}
interface PeerBandsConfig {
  sizeBands: { small: SizeBandConfig; mid: SizeBandConfig; large: SizeBandConfig };
  calibratedSizeBand: string;
  managementOverheadShare: { min: number; max: number; note: string };
  corporateFunctionGroups: { groups: string[]; note: string };
}
const PEER_BANDS = peerBandsConfig as unknown as PeerBandsConfig;
const LAYER_BAND = layerBandConfig;
const CONTINGENT_BAND = contingentBandConfig;

export type SizeBandId = "small" | "mid" | "large";
export type IndustryId = "public-health" | "commercial";
export type PeerVerdict = "in line" | "over peers" | "under peers" | "not computable";
export type PeerMetric =
  | "layers"
  | "spans"
  | "management-overhead"
  | "contingent-share"
  | "corporate-cost-share";

export interface PeerCohort {
  sizeBand: SizeBandId;
  sizeLabel: string;
  industry: IndustryId;
  industryLabel: string;
  label: string;
  /** True when the organisation's size falls outside the one cohort Atlas has real bands calibrated for. */
  provisional: boolean;
}

export interface PeerBandReading {
  metric: PeerMetric;
  label: string;
  value: number;
  unit: "count" | "ratio";
  bandMin: number | null;
  bandMax: number | null;
  verdict: PeerVerdict;
  provisional: boolean;
  /** What the ratio is a share of, stated in words — a verdict on a share metric is meaningless without this. */
  denominatorBasis: string;
  note: string | null;
}

export interface PeerBenchmarkResult {
  cohort: PeerCohort;
  readings: PeerBandReading[];
}

export function classifySizeBand(headcount: number): { id: SizeBandId; label: string } {
  if (headcount < (PEER_BANDS.sizeBands.small.maxHeadcount ?? 0)) {
    return { id: "small", label: PEER_BANDS.sizeBands.small.label };
  }
  if (headcount <= (PEER_BANDS.sizeBands.mid.maxHeadcount ?? Infinity)) {
    return { id: "mid", label: PEER_BANDS.sizeBands.mid.label };
  }
  return { id: "large", label: PEER_BANDS.sizeBands.large.label };
}

export function classifyIndustry(business: BusinessContext): { id: IndustryId; label: string } {
  return isPublicHealthSector(business)
    ? { id: "public-health", label: "public health / clinical services" }
    : { id: "commercial", label: "commercial (Atlas has no further industry-specific peer data yet)" };
}

export function classifyCohort(headcount: number, business: BusinessContext): PeerCohort {
  const size = classifySizeBand(headcount);
  const industry = classifyIndustry(business);
  return {
    sizeBand: size.id,
    sizeLabel: size.label,
    industry: industry.id,
    industryLabel: industry.label,
    label: `${size.label}, ${industry.label}`,
    provisional: size.id !== PEER_BANDS.calibratedSizeBand,
  };
}

function bandVerdict(value: number, min: number, max: number): PeerVerdict {
  if (value < min) return "under peers";
  if (value > max) return "over peers";
  return "in line";
}

/**
 * A heavily clinical organisation's overhead share must be read against the
 * non-clinical estate, not total cost — the skill spec's own worked example.
 * Applied identically to every share metric this module benchmarks, not just
 * the one the spec happens to illustrate it with.
 */
function baseCost(totalCost: number, clinicalCost: number, industry: IndustryId): { base: number; basisLabel: string } {
  if (industry !== "public-health") {
    return { base: totalCost, basisLabel: "share of total organisational cost" };
  }
  return {
    base: Math.max(totalCost - clinicalCost, 0),
    basisLabel: "share of non-clinical cost — clinical delivery excluded from the base",
  };
}

function layersReading(metrics: DiagnosticMetrics, cohort: PeerCohort): PeerBandReading {
  const verdict = bandVerdict(metrics.layers, LAYER_BAND.healthyMin, LAYER_BAND.healthyMax);
  return {
    metric: "layers",
    label: "Management layers",
    value: metrics.layers,
    unit: "count",
    bandMin: LAYER_BAND.healthyMin,
    bandMax: LAYER_BAND.healthyMax,
    verdict,
    provisional: cohort.provisional,
    denominatorBasis: "count of layers from the top of the establishment to the deepest position",
    note: cohort.provisional
      ? `Peer data isn't yet differentiated for a ${cohort.sizeLabel} organisation — read against the same mid-size band, marked provisional rather than presented as calibrated for this size.`
      : null,
  };
}

function spansReading(metrics: DiagnosticMetrics): PeerBandReading {
  return {
    metric: "spans",
    label: "Average span of control",
    value: metrics.averageSpan,
    unit: "count",
    bandMin: null,
    bandMax: null,
    verdict: "not computable",
    provisional: false,
    denominatorBasis: "average direct reports per manager, organisation-wide",
    note:
      "A single organisation-wide span band conflates a call-centre supervisor with a project director — the same reason " +
      "b1-spans-of-control reads per work archetype rather than one flat number. See the archetype breakdown for a peer " +
      "read that means something; this figure is shown without a verdict.",
  };
}

function managementOverheadReading(
  metrics: DiagnosticMetrics,
  managerCost: number,
  cohort: PeerCohort
): PeerBandReading {
  const { base, basisLabel } = baseCost(metrics.totalCost, metrics.clinicalCost, cohort.industry);
  const value = base > 0 ? managerCost / base : 0;
  const { min, max } = PEER_BANDS.managementOverheadShare;
  const verdict = bandVerdict(value, min, max);

  let note: string | null = cohort.provisional
    ? `Peer data isn't yet differentiated for a ${cohort.sizeLabel} organisation — read against the same mid-size band, marked provisional.`
    : null;

  if (cohort.industry === "public-health" && metrics.totalCost > 0) {
    const naiveValue = managerCost / metrics.totalCost;
    if (Math.abs(naiveValue - value) > 0.005) {
      const crossCheck =
        `Read against total cost instead, this would show ${(naiveValue * 100).toFixed(0)}% — the non-clinical base is ` +
        `the correct one for a clinical organisation, per this skill's own denominator rule. A low headline share can mean ` +
        `a genuinely lean corporate function, or it can mean the wrong base was used.`;
      note = note ? `${note} ${crossCheck}` : crossCheck;
    }
  }

  return {
    metric: "management-overhead",
    label: "Management overhead",
    value,
    unit: "ratio",
    bandMin: min,
    bandMax: max,
    verdict,
    provisional: cohort.provisional,
    denominatorBasis: `management cost as a ${basisLabel}`,
    note,
  };
}

function contingentShareReading(reliance: ContingentRelianceResult, cohort: PeerCohort): PeerBandReading {
  const verdict: PeerVerdict = reliance.overall.verdict === "in-line" ? "in line" : "over peers";
  return {
    metric: "contingent-share",
    label: "Contingent / agency share",
    value: reliance.overall.agencyShare,
    unit: "ratio",
    bandMin: CONTINGENT_BAND.peerBandMin,
    bandMax: CONTINGENT_BAND.peerBandMax,
    verdict,
    provisional: cohort.provisional,
    denominatorBasis: "agency or contingent headcount as a share of total establishment headcount",
    note:
      (cohort.provisional
        ? `Peer data isn't yet differentiated for a ${cohort.sizeLabel} organisation — read against the same mid-size band, marked provisional. `
        : "") +
      (reliance.overall.verdict === "structural"
        ? `Above the ${(CONTINGENT_BAND.structuralThreshold * 100).toFixed(0)}% structural-reliance line, not just the peer band.`
        : reliance.overall.verdict === "elevated"
          ? "Above the peer band but below the structural-reliance line — worth watching, not yet a redesign case."
          : "") || null,
  };
}

function corporateCostShareReading(comparison: UnitComparison, metrics: DiagnosticMetrics, cohort: PeerCohort): PeerBandReading {
  if (comparison.dimension !== "function") {
    return {
      metric: "corporate-cost-share",
      label: "Corporate cost share",
      value: 0,
      unit: "ratio",
      bandMin: null,
      bandMax: null,
      verdict: "not computable",
      provisional: cohort.provisional,
      denominatorBasis: "no department/function column reached this establishment, so functions can't be summed",
      note: "This establishment was compared by reporting-tree division rather than function, so a function-group cost share can't be read.",
    };
  }

  const corporateGroups = new Set(PEER_BANDS.corporateFunctionGroups.groups);
  const corporateCost = comparison.units.filter((u) => corporateGroups.has(u.key)).reduce((s, u) => s + u.cost, 0);
  const { base, basisLabel } = baseCost(metrics.totalCost, metrics.clinicalCost, cohort.industry);
  const value = base > 0 ? corporateCost / base : 0;

  return {
    metric: "corporate-cost-share",
    label: "Corporate cost share",
    value,
    unit: "ratio",
    bandMin: null,
    bandMax: null,
    verdict: "not computable",
    provisional: cohort.provisional,
    denominatorBasis: `${PEER_BANDS.corporateFunctionGroups.groups.join(", ")} cost as a ${basisLabel}`,
    note: PEER_BANDS.corporateFunctionGroups.note,
  };
}

export function buildPeerBenchmark(
  positions: Position[],
  rootId: string | null,
  metrics: DiagnosticMetrics,
  managerCost: number,
  business: BusinessContext,
  comparison: UnitComparison,
  reliance: ContingentRelianceResult
): PeerBenchmarkResult {
  const headcount = tagNodes(positions, rootId).filter((n) => !n.synthetic).length;
  const cohort = classifyCohort(headcount, business);

  return {
    cohort,
    readings: [
      layersReading(metrics, cohort),
      spansReading(metrics),
      managementOverheadReading(metrics, managerCost, cohort),
      contingentShareReading(reliance, cohort),
      corporateCostShareReading(comparison, metrics, cohort),
    ],
  };
}

export interface ContributionRecord {
  sizeBand: SizeBandId;
  industry: IndustryId;
  layers: number;
  averageSpan: number;
  managementOverheadShare: number;
  contingentShare: number;
}

/**
 * Step 5 of the skill spec: only where the client has consented, a
 * de-identified structural-ratio record — never a name, an individual, or a
 * person-linked salary, by construction (the return type structurally
 * cannot carry one). Atlas has no live cross-client library to write this
 * to yet, so this returns the record that would be transmitted rather than
 * transmitting it; wiring it to a real shared library is a later-phase gap,
 * not something this function papers over.
 */
export function buildContributionRecord(
  peer: PeerBenchmarkResult,
  metrics: DiagnosticMetrics,
  consent: boolean
): { contributed: boolean; record: ContributionRecord | null; reason: string } {
  if (!consent) {
    return {
      contributed: false,
      record: null,
      reason: "No consent recorded — the comparison still runs against the existing library, but nothing is written back.",
    };
  }

  const byMetric = new Map(peer.readings.map((r) => [r.metric, r] as const));
  return {
    contributed: true,
    record: {
      sizeBand: peer.cohort.sizeBand,
      industry: peer.cohort.industry,
      layers: metrics.layers,
      averageSpan: metrics.averageSpan,
      managementOverheadShare: byMetric.get("management-overhead")?.value ?? 0,
      contingentShare: byMetric.get("contingent-share")?.value ?? 0,
    },
    reason: "De-identified structural ratios queued for the shared library — spans, layers and ratios by cohort only.",
  };
}

export const PEER_BENCHMARK_METHOD =
  "The one comparison in Atlas that reads outward rather than against the organisation's own median. Every verdict is " +
  "expressed as a band position (in line / over peers / under peers), never a percentile point estimate, and every share " +
  "metric states what it's a share of before it states a verdict — a heavily clinical organisation's management overhead " +
  "is read against its non-clinical cost, not total cost, the same denominator discipline b4-organizational-shape applies " +
  "to itself. An organisation outside Atlas's one calibrated size cohort still gets a read, marked provisional rather than " +
  "silently treated as if it were calibrated for that size.";
