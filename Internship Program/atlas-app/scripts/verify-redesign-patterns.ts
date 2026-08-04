/**
 * Verifies Phase 6's H1 (redesign-pattern-library): the seven named
 * patterns, the play/parsed-move mapping onto them, the nearest-pattern
 * rejection for an uncompilable instruction, and the guardrail checklist —
 * including the roster exemption scoped correctly to management-chain
 * patterns only, the exact distinction this build got wrong on the first
 * pass (it briefly blocked wide-span-redistribution's own candidates).
 *
 * Runs in memory. No database, no network, no key.
 *
 * Run with `npx tsx scripts/verify-redesign-patterns.ts`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEstablishmentFile } from "../lib/ingest/parseFile";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { tagNodes } from "../lib/graph/tagging";
import { parseScenarioText } from "../lib/scenario/moveParser";
import {
  PATTERN_LIBRARY,
  patternForPlay,
  patternForParsedMove,
  rejectWithNearestPattern,
  guardrailLogForReassign,
  moveToPrimitive,
} from "../lib/scenario/patterns";
import { SCENARIO_PLAYS } from "../lib/scenario/plays";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function main() {
  console.log("1. Every play maps to at most one named pattern — none forced");
  const mapped = SCENARIO_PLAYS.map((p) => ({ id: p.id, pattern: patternForPlay(p.id) }));
  for (const { id, pattern } of mapped) console.log(`   ${id.padEnd(24)} -> ${pattern ?? "(no named pattern — a real play, just not one of the seven)"}`);
  assert(patternForPlay("deep-chain-compression") === "collapse-layer", "deep-chain-compression should map to collapse-layer");
  assert(patternForPlay("shared-service") === "consolidate-to-shared-service", "shared-service should map to consolidate-to-shared-service");
  assert(patternForPlay("agency-premium") === "agency-to-permanent-conversion", "agency-premium should map to agency-to-permanent-conversion");
  assert(patternForPlay("vacancy-rationalisation") === null, "vacancy-rationalisation is a real play but not one of the seven named patterns — must read null, not forced");
  assert(patternForPlay("shadow-roles") === null, "shadow-roles likewise must read null");
  assert(PATTERN_LIBRARY.length === 7, `expected exactly 7 named patterns, got ${PATTERN_LIBRARY.length}`);
  assert(PATTERN_LIBRARY.filter((p) => p.sourcePlays.length === 0).length === 2, "rebalance-mix and redistribute-center-site have no play behind them yet — must show honestly, not hidden");

  console.log("\n2. Typed instructions map to patterns where unambiguous, honestly not where they aren't");
  assert(patternForParsedMove(parseScenarioText("flatten Corporate Services to 3 layers")) === "collapse-layer", "flatten should map to collapse-layer");
  assert(patternForParsedMove(parseScenarioText("merge Finance into Shared Services")) === "consolidate-to-shared-service", "merge should map to consolidate-to-shared-service");
  assert(patternForParsedMove(parseScenarioText("remove the CFO")) === null, "a bare remove could be several patterns depending on the target's shape — must not guess from text alone");
  console.log("   flatten -> collapse-layer, merge -> consolidate-to-shared-service, bare remove -> unmapped (resolved against the graph, not the text)");

  console.log("\n3. An uncompilable instruction is rejected with the nearest named pattern, never invented");
  const rejection = rejectWithNearestPattern("please sort out the agency contractors in Facilities");
  assert(rejection.nearestPattern === "agency-to-permanent-conversion", `expected agency-to-permanent-conversion as the nearest pattern, got ${rejection.nearestPattern}`);
  assert(rejection.reason.includes("Agency-to-permanent"), "the rejection reason must name the pattern, not just say 'unrecognized'");
  const genuinelyUnmatched = rejectWithNearestPattern("do something clever with the org chart");
  assert(genuinelyUnmatched.nearestPattern === null, "text matching no pattern keyword must honestly return null, not a forced guess");
  console.log(`   "...agency contractors..." -> nearest pattern "${rejection.nearestPattern}"; genuinely unmatched text -> null, not forced`);

  console.log("\n4. The roster exemption is scoped to management-chain patterns only — the real bug this build found and fixed");
  const buffer = await readFile(path.join(process.cwd(), "db", "seed-data", "meridian-full-establishment.csv"));
  const parsed = parseEstablishmentFile("meridian-full-establishment.csv", buffer);
  const { positions } = await buildOrgGraph(parsed, { orgId: "verify-h1", anonymize: false });
  const rootId = positions.find((p) => p.managerId === null)?.id ?? null;
  const tagged = tagNodes(positions, rootId);

  const rosterLead = tagged.find((n) => n.flags.unitRoster);
  assert(rosterLead, "expected at least one roster lead (Nurse Unit Manager) in the meridian-full fixture");
  const rosterMember = tagged.find((n) => n.managerId === rosterLead!.id);
  assert(rosterMember, "expected the roster lead to have at least one report to test with");
  const otherManager = tagged.find((n) => n.childIds.length > 0 && n.id !== rosterLead!.id && n.department === rosterLead!.department);
  assert(otherManager, "expected another manager in the same department to reassign the roster member to");

  const collapseLog = guardrailLogForReassign(positions, rootId, rosterMember!.id, otherManager!.id, "collapse-layer");
  const rosterCheckCollapse = collapseLog.find((c) => c.name.startsWith("not a roster member"));
  assert(rosterCheckCollapse && !rosterCheckCollapse.passed, "collapse-layer is a management-chain pattern — moving a roster member under it must fail the roster-exemption check");

  const widenLog = guardrailLogForReassign(positions, rootId, rosterMember!.id, otherManager!.id, "widen-span");
  const rosterCheckWiden = widenLog.find((c) => c.name.startsWith("not a roster member"));
  assert(rosterCheckWiden && rosterCheckWiden.passed, "widen-span is NOT a management-chain pattern — legitimate roster rebalancing must pass this check, or wide-span-redistribution's own candidates would be blocked");
  console.log(`   Same reassignment of a roster member: blocked under "collapse-layer" (management-chain), allowed under "widen-span" (not) — correctly scoped`);

  console.log("\n5. The full guardrail checklist is logged, not just the first failure");
  assert(collapseLog.length >= 5, `expected at least 5 named guardrail checks logged, got ${collapseLog.length}`);
  assert(collapseLog.every((c) => typeof c.passed === "boolean" && c.name.length > 0), "every log entry must be named and have a definite pass/fail");
  console.log(`   ${collapseLog.length} named checks logged: ${collapseLog.map((c) => `${c.name} (${c.passed ? "pass" : "blocked"})`).join("; ")}`);

  console.log("\n6. Primitive lowering — a recorded Move traces to exactly one of the extended primitive kinds");
  const removeMove = { id: "m1", kind: "remove" as const, raw: "remove X", description: "Removed X", blocked: false, appliedAt: new Date().toISOString() };
  const flattenMove = { id: "m2", kind: "flatten" as const, raw: "flatten Y", description: "Flattened Y", blocked: false, appliedAt: new Date().toISOString() };
  const rebaseMove = { id: "m3", kind: "rebase" as const, raw: "rebase Z", description: "Rebased Z", blocked: false, appliedAt: new Date().toISOString() };
  assert(moveToPrimitive(removeMove, "p1")?.kind === "remove-role", "a remove move must lower to remove-role");
  assert(moveToPrimitive(flattenMove, "p2")?.kind === "collapse-layer", "a flatten move must lower to collapse-layer");
  assert(moveToPrimitive(rebaseMove, "p3")?.kind === "rebase-cost", "a rebase move must lower to the extended rebase-cost kind, not be force-mapped onto one of the spec's three");
  console.log("   remove -> remove-role, flatten -> collapse-layer, rebase -> rebase-cost (the spec's own 3-primitive vocabulary doesn't anticipate this one — kept honest, not force-mapped)");

  console.log("\nverify-redesign-patterns PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
