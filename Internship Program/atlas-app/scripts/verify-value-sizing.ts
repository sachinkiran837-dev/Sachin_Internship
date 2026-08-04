/**
 * Verifies Phase 5's G2 (value-sizing) reconciliation against the real
 * meridian-full-establishment fixture, where several plays genuinely
 * compete for the same roles (a Finance Director claimed by three plays at
 * once, several Maintenance Contractors claimed by both agency-premium and
 * contractor-insourcing) — real overlap, not a constructed edge case.
 *
 * Runs in memory. No database, no network, no key.
 *
 * Run with `npx tsx scripts/verify-value-sizing.ts`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEstablishmentFile } from "../lib/ingest/parseFile";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { analyseAllPlays } from "../lib/scenario/plays";
import { reconcileValue } from "../lib/scenario/reconcile";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function main() {
  const buffer = await readFile(path.join(process.cwd(), "db", "seed-data", "meridian-full-establishment.csv"));
  const parsed = parseEstablishmentFile("meridian-full-establishment.csv", buffer);
  const { positions } = await buildOrgGraph(parsed, { orgId: "verify-g2", anonymize: false });
  const rootId = positions.find((p) => p.managerId === null)?.id ?? null;
  const plays = analyseAllPlays(positions, rootId);
  const r = reconcileValue(positions, plays);

  console.log("1. The reconciled stack never exceeds the unreconciled sum of every play's own claim");
  const rawSum = plays.reduce((s, p) => s + p.analysis.projectedSaving, 0);
  assert(Math.abs(r.headline.grossStack - rawSum) < 1, `grossStack should equal the raw sum of every play's projectedSaving: ${r.headline.grossStack} vs ${rawSum}`);
  assert(r.headline.netStack < r.headline.grossStack, "the reconciled, transition-cost-netted stack must be strictly below the gross stack once any role is contested or any role is removed");
  console.log(`   gross $${r.headline.grossStack.toLocaleString()} -> net (reconciled, run-rate) $${Math.round(r.headline.netStack).toLocaleString()}`);

  console.log("\n2. Real overlap on this fixture is caught, not missed");
  assert(r.contestedRoles.length > 0, "expected real contested roles on the meridian-full fixture — several plays compete for the same Finance Director and Maintenance Contractor roles");
  const financeDirector = r.contestedRoles.find((c) => c.title === "Finance Director");
  assert(financeDirector, "expected the Finance Director to be claimed by more than one play");
  assert(financeDirector!.claimants.length >= 3, `expected pass-through-layers, thin-span-consolidation and manager-ratio all claiming Finance Director, got ${financeDirector!.claimants.map((c) => c.playId)}`);
  assert(financeDirector!.wonBy === "pass-through-layers", `first play in the fixed play order wins an exact tie deterministically — expected pass-through-layers, got ${financeDirector!.wonBy}`);
  console.log(`   ${r.contestedRoles.length} contested role(s) — Finance Director claimed by ${financeDirector!.claimants.length} plays, won by "${financeDirector!.wonBy}"`);

  console.log("\n3. A role's saving counts in exactly one opportunity — no role appears in two winners' totals");
  const winningClaims = new Map<string, string>();
  for (const { play, analysis } of plays) {
    for (const c of analysis.candidates) {
      if (r.contestedRoles.some((cr) => cr.positionId === c.positionId && cr.wonBy !== play.id)) continue; // lost this one
      const already = winningClaims.get(c.positionId);
      assert(!already || already === play.id, `role ${c.positionId} counted as a win in both ${already} and ${play.id}`);
      winningClaims.set(c.positionId, play.id);
    }
  }
  console.log(`   ${winningClaims.size} roles verified to count in exactly one winning opportunity`);

  console.log("\n4. Losing a contested role zeroes its transition cost too, not just its saving credit");
  const deepChain = r.opportunities.find((o) => o.playId === "deep-chain-compression");
  assert(deepChain, "expected deep-chain-compression to still appear as a (fully reconciled-away) opportunity");
  assert(deepChain!.netSaving === 0, `deep-chain-compression lost its only candidate — net saving must be 0, got ${deepChain!.netSaving}`);
  assert(deepChain!.transitionCost === 0, `a play that lost its only role must not still be charged that role's transition cost — got ${deepChain!.transitionCost}`);
  assert(deepChain!.netAtRunRate === 0, `net-at-run-rate must be 0, not negative, once both the saving and its transition cost are correctly excluded, got ${deepChain!.netAtRunRate}`);
  assert(deepChain!.breakEvenMonths === null, "there is no break-even on a zero saving — must read null, never a division artefact");
  console.log(`   deep-chain-compression: net $0, transition cost $0, break-even null — correctly zeroed out, not left at an artificial loss`);

  console.log("\n5. Estimate class and value type travel with every figure, never flattened");
  const agency = r.opportunities.find((o) => o.playId === "agency-premium");
  const contractor = r.opportunities.find((o) => o.playId === "contractor-insourcing");
  assert(agency?.estimateClass === "estimated", `agency-premium's conversion feasibility isn't confirmed — must read "estimated", got ${agency?.estimateClass}`);
  assert(contractor?.estimateClass === "estimated", `contractor-insourcing must read "estimated" for the same reason, got ${contractor?.estimateClass}`);
  const managerRatio = r.opportunities.find((o) => o.playId === "manager-ratio");
  assert(managerRatio?.estimateClass === "computed", `manager-ratio has real cost data — must read "computed", got ${managerRatio?.estimateClass}`);
  assert(r.headline.byValueType["capacity-release"] === 0, "no play in this library produces a genuine capacity-release figure yet — the bucket must read honestly empty, not force a mapping");
  console.log(`   by estimate class: computed $${Math.round(r.headline.byEstimateClass.computed).toLocaleString()}, estimated $${Math.round(r.headline.byEstimateClass.estimated).toLocaleString()}, requires-data $${r.headline.byEstimateClass["requires-data"]}`);

  console.log("\n6. The headline net figure reconciles arithmetically from the opportunity list, every time");
  const recomputedNet = r.opportunities.reduce((s, o) => s + o.netAtRunRate, 0);
  assert(Math.abs(recomputedNet - r.headline.netStack) < 1, `headline.netStack must equal the sum of every opportunity's own netAtRunRate: ${r.headline.netStack} vs ${recomputedNet}`);
  console.log("   headline.netStack independently recomputed from the opportunity list and matches exactly");

  console.log("\nverify-value-sizing PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
