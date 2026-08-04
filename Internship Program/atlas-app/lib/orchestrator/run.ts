import { computeMetrics } from "@/lib/metrics/diagnostics";
import { analyseFunctions, type FunctionAnalysis } from "@/lib/analysis/functions";
import { buildFootprint, type FootprintResult } from "@/lib/analysis/footprint";
import { findDuplicatedFunctions, type DuplicationCandidate } from "@/lib/analysis/duplication";
import { benchmarkFunctions, type BackOfficeReading } from "@/lib/analysis/backOfficeBenchmarks";
import { computeProductivity, type ProductivityReading } from "@/lib/analysis/productivity";
import { buildVacancyHygiene, type VacancyHygieneResult } from "@/lib/analysis/vacancyHygiene";
import { buildContingentReliance, type ContingentRelianceResult } from "@/lib/analysis/contingentReliance";
import { buildWorkforceMix, type WorkforceMixResult } from "@/lib/analysis/workforceMix";
import { buildKeyPersonRisk, type KeyPersonRiskResult } from "@/lib/analysis/keyPersonRisk";
import { mapAwardCoverage, type AwardCoverageReading } from "@/lib/analysis/irEbaOverlay";
import { buildPeerBenchmark, type PeerBenchmarkResult } from "@/lib/analysis/peerBenchmark";
import { buildHypotheses, type Hypothesis } from "@/lib/hypothesis/build";
import { EMPTY_BUSINESS, type BusinessContext } from "@/lib/hypothesis/context";
import type { DiagnosticMetrics, IngestIssue, Position } from "@/lib/graph/types";

/**
 * The analytical bundle runner: B through G, in the order
 * `scripts/verify-orchestrator-graph.ts` checks against real imports —
 * F waits on C and D, G waits on E and F, exactly as documented in the
 * orchestrator design doc. One function, imperative, because there is
 * exactly one traversal order; a generic graph-executor here would be
 * machinery with no second use.
 *
 * No new skip-condition logic is written. Every module below already
 * reports its own computability — `BandVerdict`/`PeerVerdict`'s
 * `"not computable"`, `WorkforceMixResult`'s coverage fields,
 * `AwardCoverageReading`'s per-row `mapped` — this file's only job is
 * reading each one's existing signal into a uniform log.
 *
 * `buildHypotheses` (G) recomputes B–F internally to assemble its evidence
 * blocks; calling it here duplicates that work rather than threading this
 * bundle's own results into it. That's a deliberate, bounded cost: every
 * function involved is a pure, synchronous, in-memory computation over data
 * already loaded, so doubling it is milliseconds, not a redesign of
 * `buildHypotheses`'s signature to accept a pre-computed bundle — which
 * would touch already-shipped, working code for a saving that doesn't
 * matter at this scale.
 */

export interface OrchestratorLogEntry {
  worker: string;
  status: "computed" | "skipped";
  reason?: string;
}

export interface AnalyticalBundle {
  metrics: DiagnosticMetrics;
  analysis: FunctionAnalysis;
  footprint: FootprintResult;
  duplicates: DuplicationCandidate[];
  backOffice: BackOfficeReading[];
  productivity: ProductivityReading;
  vacancy: VacancyHygieneResult;
  contingent: ContingentRelianceResult;
  workforceMix: WorkforceMixResult;
  keyPersonRisk: KeyPersonRiskResult;
  awardCoverage: AwardCoverageReading[];
  peerBenchmark: PeerBenchmarkResult;
  hypotheses: Hypothesis[];
  log: OrchestratorLogEntry[];
}

export function runAnalyticalBundle(
  positions: Position[],
  rootId: string | null,
  business: BusinessContext = EMPTY_BUSINESS,
  issues: Pick<IngestIssue, "kind">[] = []
): AnalyticalBundle {
  const log: OrchestratorLogEntry[] = [];

  // Layer 1 — independent leaves off A.
  const metrics = computeMetrics(positions, rootId, issues);
  log.push({ worker: "B", status: "computed" });

  const analysis = analyseFunctions(positions, rootId, business);
  const comparison = analysis.primary;

  const footprint = buildFootprint(positions, rootId);

  const agencyShareByUnit = new Map(comparison.units.map((u) => [u.key, u.agencyShare] as const));
  const vacancy = buildVacancyHygiene(positions, rootId, agencyShareByUnit);
  log.push({ worker: "D:vacancy-hygiene", status: "computed" });

  const workforceMix = buildWorkforceMix(positions, rootId);
  const workforceComputable = workforceMix.gradeCoverage > 0 || workforceMix.tenureCoverage > 0;
  log.push(
    workforceComputable
      ? { worker: "D:workforce-mix", status: "computed" }
      : {
          worker: "D:workforce-mix",
          status: "skipped",
          reason: "no classification/grade or tenure data supplied — gradeCoverage and tenureCoverage both read 0",
        }
  );

  const keyPersonRisk = buildKeyPersonRisk(positions, rootId);
  log.push({ worker: "E:key-person-risk", status: "computed" });

  // Layer 2 — needs Layer 1's outputs.
  const duplicates = findDuplicatedFunctions(footprint);
  log.push({ worker: "C:footprint-duplication", status: "computed" });

  const backOffice = benchmarkFunctions(comparison, business, metrics.totalFte);
  const backOfficeComputable = backOffice.some((b) => b.verdict !== "not computable");
  log.push(
    backOfficeComputable
      ? { worker: "C:back-office-benchmarks", status: "computed" }
      : { worker: "C:back-office-benchmarks", status: "skipped", reason: "no back-office function matched a configured band" }
  );

  const contingent = buildContingentReliance(positions, rootId, comparison, vacancy);
  log.push({ worker: "D:contingent-reliance", status: "computed" });

  const awardCoverage = mapAwardCoverage(positions);
  const awardComputable = awardCoverage.some((c) => c.mapped);
  log.push(
    awardComputable
      ? { worker: "E3:award-coverage", status: "computed" }
      : { worker: "E3:award-coverage", status: "skipped", reason: "no award/EBA coverage data ingested — every row reads unmapped" }
  );

  // Layer 3 — needs Layer 2's outputs.
  const productivity = computeProductivity(metrics, business);
  log.push({ worker: "C:productivity", status: "computed" });

  const peerBenchmark = buildPeerBenchmark(
    positions,
    rootId,
    metrics,
    metrics.shape.managerCost,
    business,
    comparison,
    contingent
  );
  const peerComputable = peerBenchmark.readings.some((r) => r.verdict !== "not computable");
  log.push(
    peerComputable
      ? { worker: "F:peer-benchmark", status: "computed" }
      : { worker: "F:peer-benchmark", status: "skipped", reason: "no comparable cohort data — every reading is not computable" }
  );

  // Layer 4 — needs Layer 1-3's outputs (E and F both), not just "B-F as a block".
  const { hypotheses } = buildHypotheses(positions, rootId, business, issues);
  log.push({ worker: "G", status: "computed" });

  return {
    metrics,
    analysis,
    footprint,
    duplicates,
    backOffice,
    productivity,
    vacancy,
    contingent,
    workforceMix,
    keyPersonRisk,
    awardCoverage,
    peerBenchmark,
    hypotheses,
    log,
  };
}
