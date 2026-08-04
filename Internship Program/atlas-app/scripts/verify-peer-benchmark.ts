/**
 * Verifies Phase 4's Module F (F1 peer-benchmarking) against hand-computed
 * expectations on three purpose-built in-memory fixtures — a mid-size
 * commercial establishment (the one calibrated cohort), a public-health
 * establishment sized to prove the denominator-consistency swap the skill
 * spec's own worked example describes, and a small establishment sized to
 * exercise the provisional-cohort path.
 *
 * Runs in memory. No database, no network, no key.
 *
 * Run with `npx tsx scripts/verify-peer-benchmark.ts`.
 */
import { randomUUID } from "node:crypto";
import { analyseFunctions } from "../lib/analysis/functions";
import { buildContingentReliance } from "../lib/analysis/contingentReliance";
import { computeMetrics } from "../lib/metrics/diagnostics";
import {
  buildPeerBenchmark,
  buildContributionRecord,
  classifySizeBand,
  classifyCohort,
} from "../lib/analysis/peerBenchmark";
import { buildHypotheses } from "../lib/hypothesis/build";
import { EMPTY_BUSINESS, type BusinessContext } from "../lib/hypothesis/context";
import type { Position } from "../lib/graph/types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

const ORG = "fixture";

function pos(over: Partial<Position> & { title: string; department: string; functionGroup: string }): Position {
  return {
    id: randomUUID(),
    orgId: ORG,
    rawName: null,
    displayName: over.title,
    site: null,
    grade: null,
    startDate: null,
    vacantSince: null,
    managerId: null,
    cost: 90_000,
    fte: 1,
    status: "filled",
    clinicalFlag: false,
    sourceRowIndex: 0,
    confidence: {},
    classificationSource: "fallback",
    synthetic: false,
    ...over,
  };
}

function business(sector: string): BusinessContext {
  return { ...EMPTY_BUSINESS, raw: sector, sector, source: "ai" };
}

function run(positions: Position[], sector: string) {
  const rootId = positions.find((p) => p.managerId === null)!.id;
  const biz = business(sector);
  const metrics = computeMetrics(positions, rootId);
  const { primary: comparison } = analyseFunctions(positions, rootId, biz);
  const reliance = buildContingentReliance(positions, rootId, comparison, undefined);
  const peer = buildPeerBenchmark(positions, rootId, metrics, metrics.shape.managerCost, biz, comparison, reliance);
  return { rootId, metrics, comparison, reliance, peer, biz };
}

async function main() {
  /* ---------------------------------------------------------------- */
  console.log("1. Size classification — the cohort, not a generic average");

  assert(classifySizeBand(19).id === "small", "19 headcount should read small");
  assert(classifySizeBand(173).id === "mid", "173 headcount should read mid");
  assert(classifySizeBand(3000).id === "large", "3000 headcount should read large");
  assert(classifyCohort(3000, business("commercial")).provisional, "large cohort has no calibrated band — must read provisional");
  console.log("   small/mid/large boundaries and the provisional flag for an uncalibrated size all read correctly");

  /* ---------------------------------------------------------------- */
  console.log("\n2. Mid-size commercial establishment — the one calibrated cohort");

  const mid: Position[] = [];
  const ceo = pos({ title: "Chief Executive Officer", department: "Executive", functionGroup: "Corporate & Governance", cost: 350_000 });
  mid.push(ceo);

  const cfo = pos({ title: "Chief Financial Officer", department: "Finance", functionGroup: "Finance", managerId: ceo.id, cost: 300_000 });
  const fd = pos({ title: "Finance Director", department: "Finance", functionGroup: "Finance", managerId: cfo.id, cost: 200_000 });
  const fm = pos({ title: "Finance Manager", department: "Finance", functionGroup: "Finance", managerId: fd.id, cost: 150_000 });
  const tl = pos({ title: "Team Lead", department: "Finance", functionGroup: "Finance", managerId: fm.id, cost: 100_000 });
  const acct = pos({ title: "Accountant", department: "Finance", functionGroup: "Finance", managerId: tl.id, cost: 80_000 });
  mid.push(cfo, fd, fm, tl, acct);
  for (let i = 0; i < 3; i++) {
    mid.push(pos({ title: `Accountant ${i}`, department: "Finance", functionGroup: "Finance", managerId: fm.id, cost: 75_000 }));
  }

  const cpo = pos({ title: "Chief People Officer", department: "People", functionGroup: "People", managerId: ceo.id, cost: 250_000 });
  mid.push(cpo);
  for (let i = 0; i < 7; i++) {
    mid.push(pos({ title: `People Officer ${i}`, department: "People", functionGroup: "People", managerId: cpo.id, cost: 70_000 }));
  }

  const coo = pos({ title: "Chief Operating Officer", department: "Operations", functionGroup: "Operations", managerId: ceo.id, cost: 280_000 });
  mid.push(coo);
  for (let m = 0; m < 5; m++) {
    const opsMgr = pos({ title: `Operations Manager ${m}`, department: "Operations", functionGroup: "Operations", managerId: coo.id, cost: 130_000 });
    mid.push(opsMgr);
    for (let s = 0; s < 30; s++) {
      const contingent = s < 9; // 9 of 30 per manager -> 45 of 150 overall, 30%
      mid.push(
        pos({
          title: `Operations Officer ${m}-${s}`,
          department: "Operations",
          functionGroup: "Operations",
          managerId: opsMgr.id,
          cost: 60_000,
          status: contingent ? "contingent" : "filled",
        })
      );
    }
  }

  const { metrics: midMetrics, comparison: midComparison, peer: midPeer } = run(mid, "commercial retail group");
  assert(mid.length === 173, `expected 173 positions in the mid fixture, got ${mid.length}`);
  assert(midPeer.cohort.sizeBand === "mid" && !midPeer.cohort.provisional, "173 headcount should be the calibrated mid cohort, not provisional");
  assert(midPeer.cohort.industry === "commercial", "no health keyword in the sector sentence — must read commercial");

  const byMetric = new Map(midPeer.readings.map((r) => [r.metric, r] as const));

  const layers = byMetric.get("layers")!;
  assert(midMetrics.layers === 6, `expected 6 layers (CEO..Accountant), got ${midMetrics.layers}`);
  assert(layers.verdict === "in line", `expected layers in line against the 5-6 band, got ${layers.verdict}`);

  const overhead = byMetric.get("management-overhead")!;
  assert(Math.abs(overhead.value - 2_280_000 / 12_075_000) < 0.001, `management overhead share off: got ${overhead.value}`);
  assert(overhead.verdict === "over peers", `expected management overhead over peers (~18.9% vs 10-13%), got ${overhead.verdict}`);
  assert(overhead.denominatorBasis.includes("total organisational cost"), "a commercial org reads overhead against total cost, not a clinical-adjusted base");

  const contingentReading = byMetric.get("contingent-share")!;
  assert(Math.abs(contingentReading.value - 45 / 173) < 0.001, `contingent share off: got ${contingentReading.value}`);
  assert(contingentReading.verdict === "over peers", `expected contingent share over peers (structural), got ${contingentReading.verdict}`);

  const corporate = byMetric.get("corporate-cost-share")!;
  assert(midComparison.dimension === "function", "the fixture carries a functionGroup on every position — must compare by function");
  assert(corporate.verdict === "not computable", "no numeric peer band is stated for corporate cost share in the skill spec — must read not computable");
  // Finance + People + the CEO's own "Corporate & Governance" bucket — all three are genuinely in the corporate set.
  assert(Math.abs(corporate.value - (1_055_000 + 740_000 + 350_000) / 12_075_000) < 0.001, `corporate cost share off: got ${corporate.value}`);

  console.log(
    `   layers ${midMetrics.layers} → ${layers.verdict}; management overhead ${(overhead.value * 100).toFixed(1)}% → ${overhead.verdict}; ` +
      `contingent ${(contingentReading.value * 100).toFixed(1)}% → ${contingentReading.verdict}; corporate cost share ${(corporate.value * 100).toFixed(1)}% (no band)`
  );

  const consented = buildContributionRecord(midPeer, midMetrics, true);
  assert(consented.contributed && consented.record !== null, "consent granted — a record should be produced");
  assert(
    !Object.keys(consented.record!).some((k) => /name|employee|salary/i.test(k)),
    "a contribution record must never carry a name- or salary-shaped field, by construction"
  );
  const declined = buildContributionRecord(midPeer, midMetrics, false);
  assert(!declined.contributed && declined.record === null, "no consent — nothing should be written back, but the comparison itself already ran above");
  console.log("   contribution record is de-identified by construction; withdrawal (no consent) correctly skips the write-back only");

  /* ---------------------------------------------------------------- */
  console.log("\n3. Public-health establishment — denominator consistency, not a cosmetic caveat");

  const ph: Position[] = [];
  const phCeo = pos({ title: "Chief Executive Officer", department: "Executive", functionGroup: "Corporate & Governance", cost: 100_000 });
  ph.push(phCeo);
  for (let m = 0; m < 10; m++) {
    const mgr = pos({ title: `Ward Manager ${m}`, department: "Clinical Operations", functionGroup: "Operations", managerId: phCeo.id, cost: 90_000 });
    ph.push(mgr);
    for (let n = 0; n < 18; n++) {
      ph.push(
        pos({
          title: `Registered Nurse ${m}-${n}`,
          department: "Clinical Operations",
          functionGroup: "Operations",
          managerId: mgr.id,
          cost: 90_000,
          clinicalFlag: true,
        })
      );
    }
    for (let n = 0; n < 5; n++) {
      ph.push(
        pos({
          title: `Ward Clerk ${m}-${n}`,
          department: "Clinical Operations",
          functionGroup: "Operations",
          managerId: mgr.id,
          cost: 70_000,
        })
      );
    }
  }
  // 10 managers x 18 nurses = 180 nurses, x5 clerks = 50 clerks — trim to the hand-computed 185/105 split.
  const nurses = ph.filter((p) => p.clinicalFlag);
  const clerks = ph.filter((p) => !p.clinicalFlag && p.id !== phCeo.id && !p.title.startsWith("Ward Manager"));
  assert(nurses.length === 180, `expected 180 nurses before the top-up, got ${nurses.length}`);
  assert(clerks.length === 50, `expected 50 clerks before the top-up, got ${clerks.length}`);
  const topUpMgr = ph[1];
  for (let i = 0; i < 5; i++) {
    ph.push(pos({ title: `Registered Nurse extra ${i}`, department: "Clinical Operations", functionGroup: "Operations", managerId: topUpMgr.id, cost: 90_000, clinicalFlag: true }));
  }
  for (let i = 0; i < 55; i++) {
    ph.push(pos({ title: `Ward Clerk extra ${i}`, department: "Clinical Operations", functionGroup: "Operations", managerId: topUpMgr.id, cost: 70_000 }));
  }

  const { metrics: phMetrics, peer: phPeer, biz: phBiz } = run(ph, "regional public hospital network");
  assert(phBiz.sector?.includes("hospital"), "sanity check on the sector sentence itself");
  assert(phPeer.cohort.industry === "public-health", `"hospital" in the sector sentence must classify as public-health, got ${phPeer.cohort.industry}`);

  const phManagerCost = phMetrics.shape.managerCost;
  assert(Math.abs(phManagerCost - 1_000_000) < 1, `expected manager cost of exactly 1,000,000 (CEO + 10 ward managers), got ${phManagerCost}`);
  assert(Math.abs(phMetrics.clinicalCost - 16_650_000) < 1, `expected clinical cost of 16,650,000 (185 nurses), got ${phMetrics.clinicalCost}`);
  assert(Math.abs(phMetrics.totalCost - 25_000_000) < 1, `expected total cost of 25,000,000, got ${phMetrics.totalCost}`);

  const phOverhead = phPeer.readings.find((r) => r.metric === "management-overhead")!;
  const naiveShare = phManagerCost / phMetrics.totalCost;
  assert(Math.abs(naiveShare - 0.04) < 0.001, `naive (total-cost) share should be ~4%, got ${(naiveShare * 100).toFixed(1)}%`);
  assert(Math.abs(phOverhead.value - 0.1198) < 0.001, `correct (non-clinical) share should be ~12.0%, got ${(phOverhead.value * 100).toFixed(1)}%`);
  assert(phOverhead.verdict === "in line", `the correct base reads in line against 10-13% — got ${phOverhead.verdict}`);
  assert(phOverhead.denominatorBasis.includes("non-clinical"), "denominator basis must say the base excludes clinical cost");
  assert(phOverhead.note !== null && phOverhead.note.includes("4%"), "the note must cross-check against what the naive total-cost read would have shown");
  console.log(
    `   management cost $${phManagerCost.toLocaleString()} against total cost reads ${(naiveShare * 100).toFixed(0)}% (under peers) but against the ` +
      `correct non-clinical base reads ${(phOverhead.value * 100).toFixed(1)}% (in line) — the denominator swap changes the verdict, not just the words around it`
  );

  /* ---------------------------------------------------------------- */
  console.log("\n4. Small establishment — a provisional read, not a silent extrapolation");

  const small: Position[] = [];
  const sCeo = pos({ title: "Chief Executive Officer", department: "Executive", functionGroup: "Corporate & Governance", cost: 200_000 });
  small.push(sCeo);
  for (let m = 0; m < 3; m++) {
    const mgr = pos({ title: `Manager ${m}`, department: "Operations", functionGroup: "Operations", managerId: sCeo.id, cost: 100_000 });
    small.push(mgr);
    for (let s = 0; s < 5; s++) {
      small.push(pos({ title: `Officer ${m}-${s}`, department: "Operations", functionGroup: "Operations", managerId: mgr.id, cost: 65_000 }));
    }
  }
  assert(small.length === 19, `expected 19 positions in the small fixture, got ${small.length}`);

  const { peer: smallPeer } = run(small, "commercial services firm");
  assert(smallPeer.cohort.sizeBand === "small" && smallPeer.cohort.provisional, "19 headcount is below Atlas's calibrated cohort — must read small and provisional");
  const smallLayers = smallPeer.readings.find((r) => r.metric === "layers")!;
  assert(smallLayers.provisional, "every reading for a provisional cohort must itself carry provisional: true");
  assert(smallLayers.note !== null && smallLayers.note.toLowerCase().includes("provisional"), "the reading's note must say plainly that the band isn't calibrated for this size");
  console.log(`   cohort "${smallPeer.cohort.label}" reads provisional; every reading it produces carries the same flag and says so in its note`);

  /* ---------------------------------------------------------------- */
  console.log("\n5. Wired into the hypothesis engine end to end");

  const { hypotheses } = buildHypotheses(mid, mid.find((p) => p.managerId === null)!.id, business("commercial retail group"));
  const peerHyps = hypotheses.filter((h) => h.id.startsWith("peer-benchmark:"));
  assert(peerHyps.length >= 2, `expected at least 2 peer-benchmark hypotheses (overhead, contingent), got ${peerHyps.length}`);
  assert(peerHyps.every((h) => h.lens === "External reference"), "every F1 hypothesis must carry the External reference lens");
  assert(peerHyps.every((h) => h.playId === null), "a peer-band read is a comparison, not a scenario move — no play should be attached");
  console.log(`   ${peerHyps.length} peer-benchmark hypotheses generated under the "External reference" lens`);

  console.log("\nverify-peer-benchmark PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
