/**
 * Standalone end-to-end verification of the Atlas pipeline against the real
 * sqlite db — not a page click-through, but exercises every skill's actual
 * logic module with real data: ingest -> map/metrics -> scenario mutation
 * (guardrails + audit) -> findings. Run with `npx tsx scripts/verify-pipeline.ts`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseEstablishmentFile } from "../lib/ingest/parseFile";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { tagNodes } from "../lib/graph/tagging";
import { computeMetrics } from "../lib/metrics/diagnostics";
import { reassign, remove } from "../lib/scenario/moves";
import { parseScenarioText } from "../lib/scenario/moveParser";
import { generateFindings } from "../lib/findings/generate";
import { findSafeStaffingBreaches } from "../lib/scenario/compare";
import {
  createOrg,
  savePositions,
  saveIssues,
  getBaselinePositions,
  getBaselineRootId,
  getIssues,
  getOrCreateActiveScenario,
  saveScenarioState,
  appendAuditEntry,
  getScenario,
} from "../db/repo";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function main() {
  console.log("1. Parsing seed CSV...");
  const buffer = await readFile(
    path.join(process.cwd(), "db", "seed-data", "sample-establishment.csv")
  );
  const parsed = parseEstablishmentFile("sample-establishment.csv", buffer);
  assert(parsed.rows.length === 45, `expected 45 rows, got ${parsed.rows.length}`);
  console.log(`   ${parsed.headers.length} columns, ${parsed.rows.length} rows`);

  console.log("2. Creating org + building graph (ingest, C1)...");
  const orgId = await createOrg({
    name: "verify-run",
    sourceFilename: "sample-establishment.csv",
    anonymized: true,
  });
  const { positions, issues, columnMapping } = await buildOrgGraph(parsed, { orgId, anonymize: true });
  await savePositions(positions);
  await saveIssues(issues);

  const unmapped = columnMapping.filter((c) => !c.targetField);
  assert(unmapped.length === 0, `expected every column mapped, unmapped: ${unmapped.map((c) => c.sourceColumn)}`);
  assert(positions.length === 45, `expected 45 positions, got ${positions.length}`);
  assert(issues.length === 0, `expected a clean synthetic ingest, got issues: ${JSON.stringify(issues)}`);
  assert(
    positions.every((p) => p.rawName === null && !p.displayName.includes("Alexandra")),
    "anonymization should have stripped raw names"
  );
  console.log(`   ${positions.length} positions, ${issues.length} ingest issues, all columns mapped`);

  console.log("3. Loading baseline + tagging (C4 layout/tagging)...");
  const baseline = await getBaselinePositions(orgId);
  const rootId = getBaselineRootId(baseline);
  assert(rootId !== null, "expected a resolved root");
  const root = baseline.find((p) => p.id === rootId)!;
  assert(root.title === "Chief Executive Officer", `expected CEO as root, got ${root.title}`);

  const tagged = tagNodes(baseline, rootId);
  const ceoNode = tagged.find((n) => n.id === rootId)!;
  assert(ceoNode.depth === 0, "root depth should be 0");
  const protectedNodes = tagged.filter((n) => n.flags.protected);
  assert(protectedNodes.length >= 3, `expected several protected roles, got ${protectedNodes.length}`);
  console.log(`   layers computed, ${protectedNodes.length} protected roles tagged: ${protectedNodes.map((n) => n.title).join(", ")}`);

  const patientServicesManager = tagged.find((n) => n.title === "Patient Services Manager")!;
  assert(patientServicesManager.flags.spanHealth === "wide", "Patient Services Manager should be flagged wide span (10 reports)");
  const clinicalCoordinator = tagged.find((n) => n.title === "Clinical Coordinator")!;
  assert(clinicalCoordinator.flags.singleReport, "Clinical Coordinator should be flagged single-report");
  console.log("   wide-span and single-report tagging confirmed against known seed shape");

  console.log("4. Baseline diagnostic metrics (C3 engine)...");
  const baselineMetrics = computeMetrics(baseline, rootId);
  assert(baselineMetrics.headcount === 45, `expected headcount 45, got ${baselineMetrics.headcount}`);
  assert(baselineMetrics.vacantCount === 1, `expected 1 vacant, got ${baselineMetrics.vacantCount}`);
  assert(baselineMetrics.contingentCount === 1, `expected 1 contingent, got ${baselineMetrics.contingentCount}`);
  console.log(
    `   headcount=${baselineMetrics.headcount} cost=${baselineMetrics.totalCost} layers=${baselineMetrics.layers} avgSpan=${baselineMetrics.averageSpan.toFixed(2)} protected=${baselineMetrics.protectedCount}`
  );

  console.log("5. Guardrail: attempting to remove a protected role directly (must block)...");
  const ceoAsScenarioTarget = remove(baseline, rootId, root.id);
  assert(ceoAsScenarioTarget.blocked, "removing the root must be blocked");
  const cfo = baseline.find((p) => p.title === "Chief Financial Officer")!;
  const cfoRemoveAttempt = remove(baseline, rootId, cfo.id);
  assert(cfoRemoveAttempt.blocked, "removing a protected governance role must be blocked");
  console.log(`   blocked as expected: "${cfoRemoveAttempt.blockReason}"`);

  console.log("6. Single mutation entry point: reassign via the map (C4 drag)...");
  const scenario = await getOrCreateActiveScenario(orgId);
  const analyst1 = scenario.positions.find((p) => p.title === "Finance Analyst" && p.displayName.startsWith("CM"))
    ?? scenario.positions.find((p) => p.title === "Finance Analyst")!;
  const itManager = scenario.positions.find((p) => p.title === "IT Manager")!;
  const dragOutcome = reassign(scenario.positions, rootId, analyst1.id, itManager.id);
  assert(!dragOutcome.blocked, `expected drag reassign to succeed, blocked: ${dragOutcome.blockReason}`);
  await saveScenarioState(scenario.id, dragOutcome.positions, [
    ...scenario.moves,
    { id: "move-1", kind: "reassign", raw: dragOutcome.description, description: dragOutcome.description, blocked: false, appliedAt: new Date().toISOString() },
  ]);
  await appendAuditEntry({ id: "audit-1", scenarioId: scenario.id, positionId: analyst1.id, action: "mutation", detail: dragOutcome.description, who: "verify-script", when: new Date().toISOString() });
  console.log(`   ${dragOutcome.description}`);

  console.log("7. Typed scenario move (C5): flatten Clinical Operations to 4 layers...");
  const afterDrag = await getScenario(scenario.id);
  assert(afterDrag !== null, "scenario should be loadable");
  const parsedMove = parseScenarioText("flatten Clinical Operations to 4 layers");
  assert(parsedMove.kind === "flatten", `expected a flatten move, got ${parsedMove.kind}`);

  const { flatten } = await import("../lib/scenario/moves");
  const preFlattenMetrics = computeMetrics(afterDrag!.positions, rootId);
  const flattenOutcome = flatten(afterDrag!.positions, rootId, "Clinical Operations", 4);
  assert(!flattenOutcome.blocked, `expected flatten to apply, blocked: ${flattenOutcome.blockReason}`);
  const postFlattenMetrics = computeMetrics(flattenOutcome.positions, rootId);
  assert(postFlattenMetrics.headcount < preFlattenMetrics.headcount, "flatten should reduce headcount by delayering");
  await saveScenarioState(scenario.id, flattenOutcome.positions, [
    ...afterDrag!.moves,
    { id: "move-2", kind: "flatten", raw: "flatten Clinical Operations to 4 layers", description: flattenOutcome.description, blocked: false, appliedAt: new Date().toISOString() },
  ]);
  console.log(`   ${flattenOutcome.description}`);
  console.log(`   headcount ${preFlattenMetrics.headcount} -> ${postFlattenMetrics.headcount}, layers ${preFlattenMetrics.layers} -> ${postFlattenMetrics.layers}`);

  console.log("8. Unrecognized scenario text must not silently no-op...");
  const gibberish = parseScenarioText("do the thing with the org chart please");
  assert(gibberish.kind === "unrecognized", "gibberish input must be unrecognized, not a guessed move");
  console.log("   confirmed: unrecognized input is surfaced, not hallucinated");

  console.log("9. Safe-staffing breach detection...");
  const finalScenario = await getScenario(scenario.id);
  const breaches = findSafeStaffingBreaches(baseline, finalScenario!.positions);
  console.log(`   ${breaches.length} protected/clinical positions touched (guardrails should keep true protected-tier breaches at 0)`);
  const protectedBaselineIds = new Set(tagged.filter((n) => n.flags.protected).map((n) => n.id));
  const protectedBreaches = breaches.filter((id) => protectedBaselineIds.has(id));
  assert(protectedBreaches.length === 0, "no protected-tier role should have been touched given the guardrail");

  console.log("10. Findings synthesis (C3 narrative layer, deterministic fallback since no ANTHROPIC_API_KEY)...");
  const findings = await generateFindings(postFlattenMetrics);
  assert(findings.source === "fallback", "expected deterministic fallback without an API key");
  assert(findings.findings.length > 0 && findings.findings.length <= 5, `expected 1-5 findings, got ${findings.findings.length}`);
  assert(findings.findings.some((f) => f.headline.toLowerCase().includes("protected")), "expected a dedicated protected-zone finding");
  console.log(`   narrative: "${findings.narrative}"`);
  console.log(`   ${findings.findings.length} findings: ${findings.findings.map((f) => f.headline).join(" | ")}`);

  const finalIssues = await getIssues(orgId);
  assert(finalIssues.length === issues.length, "issue count should be stable post-mutation");

  console.log("\nALL CHECKS PASSED");
  console.log(`org id for manual UI check: ${orgId}`);
  console.log(`scenario id for manual UI check: ${scenario.id}`);
}

main().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
