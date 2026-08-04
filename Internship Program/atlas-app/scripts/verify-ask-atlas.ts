/**
 * Verifies Phase 7's I3 (ask-atlas-interpretation) against the workforce-risk
 * fixture, which already carries real control gaps, key-person flags,
 * contingent reliance and vacancy data from Phase 3.
 *
 * Runs in memory. No database, no network, no key.
 *
 * Run with `npx tsx scripts/verify-ask-atlas.ts`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEstablishmentFile } from "../lib/ingest/parseFile";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { interpret } from "../lib/ask/interpret";
import type { Position } from "../lib/graph/types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function loadFixture(filename: string, orgId: string) {
  const buffer = await readFile(path.join(process.cwd(), "db", "seed-data", filename));
  const parsed = parseEstablishmentFile(filename, buffer);
  const { positions } = await buildOrgGraph(parsed, { orgId, anonymize: false });
  const rootId = positions.find((p) => p.managerId === null)?.id ?? null;
  return { positions, rootId };
}

async function main() {
  // meridian-full carries a real single-report chain (verify-value-sizing.ts
  // already prices it) — the workforce-risk fixture genuinely has none, by
  // design (it wasn't built to exercise B3), so each fixture is used where
  // it actually has the data the query needs, rather than forcing one
  // fixture to carry every case.
  const { positions, rootId } = await loadFixture("meridian-full-establishment.csv", "verify-i3-full");
  const { positions: riskPositions, rootId: riskRootId } = await loadFixture("meridian-workforce-risk-establishment.csv", "verify-i3-risk");
  // meridian-full carries no site column, so duplication (a cross-site
  // concept) genuinely finds nothing there — the multisite fixture from
  // Phase 2 is the one built to exercise C1/C2.
  const { positions: sitePositions, rootId: siteRootId } = await loadFixture("meridian-multisite-establishment.csv", "verify-i3-site");

  console.log("1. Every one of the 7 named query tools compiles and returns sourced, non-empty data");
  const queries: [string, string, Position[], string | null][] = [
    ["single-report-by-cost", "which single report managers cost the most", positions, rootId],
    ["duplicated-functions", "show me duplicated functions across sites", sitePositions, siteRootId],
    ["layers-by-division", "how many layers between the ceo and the frontline", positions, rootId],
    ["span-outliers", "which spans are wide or thin", positions, rootId],
    ["contingent-by-directorate", "contingent reliance by directorate", positions, rootId],
    ["cost-by-tier", "cost by management tier", positions, rootId],
    ["protected-and-key-person", "show me protected and key person roles", positions, rootId],
  ];
  for (const [id, text, pos, root] of queries) {
    const r = await interpret(text, pos, root);
    assert(r.compiled, `"${text}" should compile to a named tool, got uncompiled: ${r.narrative}`);
    assert(r.toolId === id, `"${text}" should match ${id}, got ${r.toolId}`);
    assert(r.toolTrace.length > 10, `${id}: expected a real tool trace naming the engine call`);
    assert(r.narrative.length > 10, `${id}: expected a real narrative, not a placeholder`);
    assert(r.data.length > 0, `${id}: expected real data rows, not an empty table`);
  }
  console.log(`   all 7 tools compiled with real data, a real narrative and a named tool trace`);

  console.log("\n2. The protected-and-key-person tool surfaces this fixture's real, known control gap");
  const r = await interpret("show me protected and key person roles", riskPositions, riskRootId);
  const controlGapRow = r.data.find((d) => d.label === "Control gaps");
  assert(controlGapRow && controlGapRow.value !== "0", `expected a real control gap on this fixture (clinical-director/public-officer unmatched), got ${controlGapRow?.value}`);
  console.log(`   ${controlGapRow!.value} control gap(s) surfaced — matches Phase 3's own known fixture design`);

  console.log("\n3. An ambiguous query naming two tools is never silently resolved to one");
  const ambiguous = await interpret("show me contingent agency and protected roles", positions, rootId);
  assert(!ambiguous.compiled, "a query matching more than one tool must never silently pick one");
  assert(ambiguous.followUps.length >= 2, "an ambiguous query should list the plausible tools as follow-ups");
  console.log(`   "${ambiguous.narrative}"`);

  console.log("\n4. A restructure instruction compiles via H1's own pattern library, not a separate reimplementation");
  const instruction = await interpret("flatten Operations to 4 layers", positions, rootId);
  assert(instruction.compiled, `expected the flatten instruction to compile, got: ${instruction.narrative}`);
  assert(instruction.kind === "instruction", `expected kind "instruction", got ${instruction.kind}`);
  assert(instruction.toolTrace.includes("patternForParsedMove"), "the trace must show it went through H1's own compilation path");
  console.log(`   "${instruction.narrative}"`);

  console.log("\n5. Nonsense compiles to neither a tool nor a pattern, and says so honestly — never invents an answer");
  const nonsense = await interpret("what is the meaning of organisational life", positions, rootId);
  assert(!nonsense.compiled, "nonsense must never compile");
  assert(nonsense.data.length === 0, "an uncompiled response must carry no data — nothing was computed");
  assert(nonsense.toolTrace.includes("No engine call ran"), "the trace must say plainly that nothing ran");
  console.log(`   "${nonsense.narrative}"`);

  console.log("\n6. An empty query is rejected, not silently answered");
  const empty = await interpret("", positions, rootId);
  assert(!empty.compiled, "an empty query must not compile to anything");
  console.log("   empty query correctly rejected");

  console.log("\nverify-ask-atlas PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
