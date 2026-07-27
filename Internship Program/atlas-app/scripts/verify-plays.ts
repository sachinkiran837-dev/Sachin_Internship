/**
 * Runs all ten redesign plays against the demo establishment and prints what
 * each one found, what it priced, and what it refused to touch. This is the
 * check that the numbers are real: a play that silently finds nothing, or
 * one that claims a saving larger than the roles it names, shows up here
 * rather than in front of a client. Run with
 * `npx tsx --env-file=.env.local scripts/verify-plays.ts`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseEstablishmentFile } from "../lib/ingest/parseFile";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { computeMetrics } from "../lib/metrics/diagnostics";
import { analyseAllPlays } from "../lib/scenario/plays";
import { remove, reassign, rebase } from "../lib/scenario/moves";
import type { Position } from "../lib/graph/types";

const money = (n: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);

async function main() {
  const buffer = await readFile(
    path.join(process.cwd(), "db", "seed-data", "meridian-full-establishment.csv")
  );
  const parsed = parseEstablishmentFile("meridian-full-establishment.csv", buffer);
  console.log(`Source: ${parsed.conversion.sourceFormat} — ${parsed.conversion.detail}`);

  const { positions } = await buildOrgGraph(parsed, { orgId: "verify-plays", anonymize: true });
  const rootId = positions.find((p) => p.managerId === null)?.id ?? null;
  const baseline = computeMetrics(positions, rootId);

  console.log(
    `\nBaseline: ${baseline.headcount} positions · ${money(baseline.totalCost)} · ${baseline.layers} layers · avg span ${baseline.averageSpan.toFixed(1)}\n`
  );

  const results = analyseAllPlays(positions, rootId);
  let failures = 0;
  let withCandidates = 0;

  for (const { play, analysis } of results) {
    const header = `${play.name}  [${analysis.savingNature}]`;
    console.log(`── ${header}`);
    console.log(`   ${analysis.summary}`);

    if (analysis.candidates.length === 0) {
      console.log(`   no candidates\n`);
      continue;
    }
    withCandidates++;

    console.log(
      `   ${analysis.candidates.length} candidate(s) · projected ${money(analysis.projectedSaving)} · headcount ${analysis.headcountDelta}`
    );
    for (const c of analysis.candidates.slice(0, 3)) {
      console.log(`     · ${c.title} (${c.department}) ${money(c.saving)} — ${c.rationale}`);
    }
    if (analysis.candidates.length > 3) console.log(`     · …${analysis.candidates.length - 3} more`);
    if (analysis.guardrailNote) console.log(`   guardrail: ${analysis.guardrailNote}`);

    // The claimed saving must equal the sum of what it named — a play that
    // prices more than it can point at is the failure mode that matters.
    const summed = analysis.candidates.reduce((s, c) => s + c.saving, 0);
    if (Math.abs(summed - analysis.projectedSaving) > 1) {
      console.log(`   ✗ projected ${money(analysis.projectedSaving)} != sum of candidates ${money(summed)}`);
      failures++;
    }

    // Replay the play's own operations and confirm the modelled saving lands.
    let current: Position[] = positions;
    let applied = 0;
    let blocked = 0;
    for (const op of analysis.operations) {
      if (!current.some((p) => p.id === op.positionId)) continue;
      const outcome =
        op.kind === "remove"
          ? remove(current, rootId, op.positionId)
          : op.kind === "reassign"
            ? reassign(current, rootId, op.positionId, op.newManagerId)
            : rebase(current, op.positionId, { cost: op.cost, status: op.status, reason: op.reason });
      if (outcome.blocked) blocked++;
      else {
        current = outcome.positions;
        applied++;
      }
    }

    const after = computeMetrics(current, rootId);
    const actualCostDelta = baseline.totalCost - after.totalCost;
    const actualHeadDelta = after.headcount - baseline.headcount;
    console.log(
      `   applied ${applied} op(s)${blocked ? `, ${blocked} blocked` : ""} → actual cost -${money(actualCostDelta)}, headcount ${actualHeadDelta}, layers ${after.layers}`
    );

    if (applied === 0) {
      console.log(`   ✗ produced candidates but every operation was blocked`);
      failures++;
    }

    // Cost-avoidance plays intentionally don't move the cost line; the rest must.
    if (analysis.savingNature !== "cost-avoidance" && actualCostDelta <= 0) {
      console.log(`   ✗ claims ${money(analysis.projectedSaving)} but the modelled cost did not fall`);
      failures++;
    }
    if (analysis.headcountDelta !== actualHeadDelta) {
      console.log(`   ✗ predicted headcount ${analysis.headcountDelta}, actual ${actualHeadDelta}`);
      failures++;
    }
    console.log();
  }

  console.log(`${withCandidates}/${results.length} plays found candidates in this dataset.`);

  if (failures > 0) {
    console.error(`\n${failures} CHECK(S) FAILED`);
    process.exit(1);
  }
  console.log("ALL PLAY CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
