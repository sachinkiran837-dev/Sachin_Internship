/**
 * Verifies the upload-context feature: the instructions a user types on the
 * ingest screen, and everything that happens because of them.
 *
 * The split this script exists to prove is the one the feature rests on. A
 * model decides what each file is for and what its columns mean — that part
 * needs an API key and is exercised separately. Everything that then *happens*
 * to the rows is arithmetic, so it is verified here against hand-written
 * plans, with no key and no network. If this passes, a wrong plan can put a
 * file in the wrong role, but it cannot produce a number that isn't in the
 * files.
 *
 * Run with `npx tsx --env-file=.env.local scripts/verify-plan.ts`.
 */
import { bindFiles, type SourceFile } from "../lib/ingest/bindFiles";
import { buildOrgGraph } from "../lib/ingest/buildGraph";
import { computeMetrics } from "../lib/metrics/diagnostics";
import { planIngest, validatePlan, type IngestPlan } from "../lib/ingest/plan";
import { remove, reassign } from "../lib/scenario/moves";
import { getBaselineRootId } from "../db/repo";
import { hasAI } from "../lib/ai/client";
import type { ParsedFile } from "../lib/ingest/parseFile";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function file(
  filename: string,
  headers: string[],
  rows: string[][],
  sourceFormat = "CSV",
  /** Set for files read from a picture — the flag the inferred-structure rule keys off. */
  fromPicture = false
): SourceFile {
  const parsed: ParsedFile = {
    headers,
    rows: rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]))),
    conversion: {
      sourceFormat,
      detail: `${rows.length} rows read for the verification harness.`,
      rowCount: rows.length,
      needsReview: fromPicture ? "Transcribed from a picture." : undefined,
    },
  };
  return { filename, parsed };
}

function plan(overrides: Partial<IngestPlan>): IngestPlan {
  return {
    files: [],
    groupBy: null,
    rowFilter: null,
    notes: "",
    warnings: [],
    source: "ai",
    model: "verification-harness",
    ...overrides,
  };
}

// --- fixtures -------------------------------------------------------------
// The shape a real messy upload takes: a payroll spreadsheet that knows who
// exists and what they cost but has flat or wrong reporting lines, and a chart
// read out of a PDF that knows the shape but has no money in it and no IDs.

const PAYROLL = file(
  "payroll-extract.xlsx",
  ["Staff ID", "Employee Name", "Job Title", "Cost Centre", "Reports To", "Annual Cost", "Brand"],
  [
    ["E1", "Dana Whitfield", "Chief Executive", "Executive", "", "410000", "Northern"],
    ["E2", "Ravi Anand", "Director of Operations", "Operations", "E1", "265000", "Northern"],
    ["E3", "Mei Lin", "Operations Manager", "Operations", "E1", "175000", "Northern"],
    ["E4", "Tom Beckett", "Operations Manager", "Operations", "E1", "172000", "Northern"],
    ["E5", "Sara Cole", "Coordinator", "Operations", "E1", "98000", "Northern"],
    ["E6", "Priya Nair", "Managing Director", "Executive", "", "300000", "Southern"],
    ["E7", "Alex Doyle", "Head of Service", "Service", "E6", "180000", "Southern"],
    ["E8", "Jo Kerr", "Service Coordinator", "Service", "E6", "92000", "Southern"],
  ],
  "Excel"
);

// The chart: titles and reporting lines, box ids of its own, no costs. Note
// that it disagrees with payroll — it says the two Operations Managers report
// to the Director, not the Chief Executive. That disagreement is the point.
const CHART = file(
  "structure.pdf",
  ["Position ID", "Employee Name", "Position Title", "Manager ID"],
  [
    ["box-1", "Dana Whitfield", "Chief Executive", ""],
    ["box-2", "Ravi Anand", "Director of Operations", "box-1"],
    ["box-3", "Mei Lin", "Operations Manager", "box-2"],
    ["box-4", "Tom Beckett", "Operations Manager", "box-2"],
    ["box-5", "Sara Cole", "Coordinator", "box-3"],
  ],
  "PDF"
);

const NOTES = file(
  "board-notes.csv",
  ["Topic", "Owner"],
  [["Restructure timing", "Dana"], ["Budget envelope", "Ravi"]]
);

async function main() {
  // --- 1. the validator refuses everything it can't check ----------------
  const dodgy = JSON.stringify({
    files: [
      { filename: "nowhere.csv", use: "positions", reason: "invented" },
      { filename: "payroll-extract.xlsx", use: "attributes", reason: "ok", columns: { "Annual Cost": "cost", "Brand": "nonsense", "Missing Column": "fte" } },
      { filename: "structure.pdf", use: "telepathy", reason: "unknown role" },
    ],
    groupBy: { column: "Legal Entity", label: "Entity", topLabel: "Group" },
    rowFilter: { column: "Brand", include: ["Northern"], exclude: [] },
    notes: "Test plan.",
  });

  const checked = validatePlan(dodgy, [
    { filename: PAYROLL.filename, parsed: PAYROLL.parsed! },
    { filename: CHART.filename, parsed: CHART.parsed! },
  ], "harness");

  assert(checked.files.length === 1, `only the one valid file plan should survive, got ${checked.files.length}`);
  assert(checked.files[0].columns["Annual Cost"] === "cost", "a valid column override must survive");
  assert(!("Brand" in checked.files[0].columns), "a column mapped to a field that doesn't exist must be dropped");
  assert(!("Missing Column" in checked.files[0].columns), "a column the file doesn't have must be dropped");
  assert(checked.groupBy === null, "grouping on a column no file has must be refused, not guessed");
  assert(checked.rowFilter?.column === "Brand", "a filter on a real column must survive");
  assert(checked.warnings.length === 5, `every rejection must be reported: got ${checked.warnings.length} — ${checked.warnings.join(" | ")}`);
  console.log(`1. Validator kept 1 of 3 file plans and reported ${checked.warnings.length} things it would not do:`);
  for (const w of checked.warnings) console.log(`   ── ${w}`);

  // --- 2. a column override beats the synonym matcher --------------------
  // "Cost Centre" is a department synonym, and Atlas reads it as one. The
  // client says it is really their brand, and that has to win.
  const overridden = bindFiles(
    [PAYROLL],
    plan({
      files: [
        {
          filename: PAYROLL.filename,
          use: "positions",
          reason: "This is the staff list.",
          columns: { "Cost Centre": "department", "Brand": "ignore" },
        },
      ],
    })
  );
  const deptReading = overridden.bindings[0].columns.find((c) => c.column === "Cost Centre");
  const brandReading = overridden.bindings[0].columns.find((c) => c.column === "Brand");
  assert(deptReading?.field === "department", `the override must hold: got ${deptReading?.field}`);
  assert(brandReading?.field === null, `an "ignore" must stop a column being read as a field: got ${brandReading?.field}`);
  console.log(`\n2. Column overrides applied: "Cost Centre" → department, "Brand" → ignored.`);

  // --- 3. scope narrowing happens before anything is bound ---------------
  const scoped = bindFiles(
    [PAYROLL],
    plan({ rowFilter: { column: "Brand", include: ["Southern"], exclude: [] } })
  );
  assert(scoped.rows.length === 3, `only the 3 Southern rows should survive, got ${scoped.rows.length}`);
  assert(scoped.filteredOut === 5, `the 5 dropped rows must be reported, got ${scoped.filteredOut}`);
  console.log(`3. Scope: 8 rows in, 3 kept, ${scoped.filteredOut} reported as left out.`);

  // --- 4. a file can be left out entirely --------------------------------
  const withIgnored = bindFiles(
    [PAYROLL, NOTES],
    plan({
      files: [{ filename: NOTES.filename, use: "ignore", reason: "These are meeting notes, not establishment data.", columns: {} }],
    })
  );
  const notesBinding = withIgnored.bindings.find((b) => b.filename === NOTES.filename)!;
  assert(notesBinding.role === "excluded", `an ignored file must be reported as excluded, got ${notesBinding.role}`);
  assert(notesBinding.planReason?.includes("meeting notes"), "the reason must be carried through to the report verbatim");
  assert(withIgnored.rows.length === 8, "excluding a file must not change what the others contribute");
  console.log(`4. "${NOTES.filename}" left out on instruction, and says why on the confirm screen.`);

  // --- 5. structure from the chart, numbers from the spreadsheet ---------
  // The whole point of the feature. Without a plan both files look like
  // position lists and the five chart rows are stacked on top of the eight
  // payroll rows, duplicating five people and keeping payroll's flat lines.
  const naive = bindFiles([PAYROLL, CHART]);
  assert(naive.rows.length === 13, `without instructions the files stack: expected 13 rows, got ${naive.rows.length}`);

  const layered = bindFiles(
    [PAYROLL, CHART],
    plan({
      files: [
        { filename: PAYROLL.filename, use: "positions", reason: "The staff list and the money.", columns: {} },
        { filename: CHART.filename, use: "structure", reason: "The org chart — use it for reporting lines.", columns: {} },
      ],
    })
  );

  const chartBinding = layered.bindings.find((b) => b.filename === CHART.filename)!;
  assert(chartBinding.role === "structure", `the chart must be used as structure, got ${chartBinding.role}`);
  assert(layered.rows.length === 8, `the chart's people must not be added twice: expected 8 rows, got ${layered.rows.length}`);
  assert(chartBinding.matchedRows === 5, `all 5 chart roles should match by name: got ${chartBinding.matchedRows}`);

  const byId = new Map(layered.rows.map((r) => [r.positionId, r] as const));
  // The chart said the Operations Managers report to the Director (box-2),
  // and box-2 is Ravi, who is E2 in the establishment. That translation is
  // the part that would silently orphan everyone if it were skipped.
  assert(byId.get("E3")!.managerName === "E2", `Mei Lin should report to E2 per the chart, got "${byId.get("E3")!.managerName}"`);
  assert(byId.get("E4")!.managerName === "E2", `Tom Beckett should report to E2 per the chart, got "${byId.get("E4")!.managerName}"`);
  assert(byId.get("E5")!.managerName === "E3", `Sara Cole should report to E3 per the chart, got "${byId.get("E5")!.managerName}"`);
  assert(byId.get("E7")!.managerName === "E6", "a role the chart says nothing about must keep the payroll line");
  assert(byId.get("E2")!.cost === "265000", "the money must survive being reshaped");
  console.log(`\n5. Structure overlay: ${chartBinding.matchedRows} of 5 chart roles matched, reporting lines translated to the establishment's own IDs.`);
  console.log(`   ── ${chartBinding.detail}`);

  // --- 5b. a chart that matches nobody is refused, not appended ----------
  const foreign = file(
    "someone-elses-chart.pdf",
    ["Position Title", "Manager ID"],
    [["Regional Vice President", ""], ["Franchise Lead", "Regional Vice President"]],
    "PDF"
  );
  const refused = bindFiles(
    [PAYROLL, foreign],
    plan({ files: [{ filename: foreign.filename, use: "structure", reason: "Use this chart.", columns: {} }] })
  );
  const refusedBinding = refused.bindings.find((b) => b.filename === foreign.filename)!;
  assert(refusedBinding.role === "unusable", `a chart matching nobody must be refused, got ${refusedBinding.role}`);
  assert(refused.rows.length === 8, "a refused chart must not add a parallel organisation");
  console.log(`5b. A chart matching nobody is refused rather than appended: "${refusedBinding.detail.slice(0, 96)}…"`);

  // --- 5c. a picture is the shape by default, without being told --------
  // The instructions box exists to say this, but it is the right answer
  // often enough that Atlas should reach it unprompted — and then say so.
  const readChart = file(
    "board-pack-chart.pdf",
    CHART.parsed!.headers,
    CHART.parsed!.rows.map((r) => CHART.parsed!.headers.map((h) => r[h])),
    "PDF",
    true
  );
  const unprompted = bindFiles([PAYROLL, readChart]);
  const inferredBinding = unprompted.bindings.find((b) => b.filename === readChart.filename)!;
  assert(inferredBinding.role === "structure", `a chart beside a spreadsheet should default to structure, got ${inferredBinding.role}`);
  assert(unprompted.rows.length === 8, `defaulting must not double the chart's people: got ${unprompted.rows.length}`);
  assert(
    inferredBinding.detail.includes("instructions box"),
    "a judgement Atlas made for itself must say so, and say how to overrule it"
  );
  const inferredById = new Map(unprompted.rows.map((r) => [r.positionId, r] as const));
  assert(inferredById.get("E3")!.managerName === "E2", "the inferred overlay must translate lines the same way");

  // ...and being told otherwise still wins.
  const overruled = bindFiles(
    [PAYROLL, readChart],
    plan({ files: [{ filename: readChart.filename, use: "positions", reason: "No, this chart is the establishment.", columns: {} }] })
  );
  assert(
    overruled.bindings.find((b) => b.filename === readChart.filename)!.role === "roster",
    "an explicit instruction must beat the default"
  );
  console.log(`5c. With no instructions at all, a chart beside a spreadsheet is taken as the shape, and says so. Instructions still override it.`);

  // --- 6. consolidation at brand level -----------------------------------
  const consolidated = bindFiles(
    [PAYROLL],
    plan({ groupBy: { columns: ["Brand"], label: "Brand", topLabel: "Meridian Group" } })
  );
  assert(consolidated.groupBy?.column === "Brand", "the grouping column must survive into the bound dataset");

  const built = await buildOrgGraph(consolidated, {
    orgId: "verify-plan",
    anonymize: false,
    groupBy: consolidated.groupBy,
  });

  const headings = built.positions.filter((p) => p.synthetic);
  assert(headings.length === 3, `expected a top node and 2 brand headings, got ${headings.length}`);

  const rootId = getBaselineRootId(built.positions);
  const top = built.positions.find((p) => p.id === rootId)!;
  assert(top.synthetic && top.title === "Meridian Group", `the root must be the group heading, got "${top.title}"`);

  // Both chief executives keep their seniority: each sits under its own
  // brand, rather than one being demoted to report to the other.
  const dana = built.positions.find((p) => p.displayName === "Dana Whitfield")!;
  const priya = built.positions.find((p) => p.displayName === "Priya Nair")!;
  const northern = built.positions.find((p) => p.synthetic && p.title === "Northern")!;
  const southern = built.positions.find((p) => p.synthetic && p.title === "Southern")!;
  assert(dana.managerId === northern.id, "the Northern chief executive must sit under the Northern heading");
  assert(priya.managerId === southern.id, "the Southern managing director must sit under the Southern heading");
  assert(northern.managerId === top.id && southern.managerId === top.id, "both brands must sit under one top node");

  const metrics = computeMetrics(built.positions, rootId);
  assert(metrics.headcount === 8, `headings must not inflate headcount: got ${metrics.headcount} for 8 real people`);
  assert(metrics.totalCost === 1692000, `headings must not change cost: got ${metrics.totalCost}`);
  // Two layers of real people — a chief executive and their reports. The two
  // headings above them are scaffolding and must not read as a third.
  assert(metrics.layers === 2, `layers must be measured over real roles only: got ${metrics.layers}`);

  const ungrouped = await buildOrgGraph(bindFiles([PAYROLL]), { orgId: "verify-plan-flat", anonymize: false });
  const flatMetrics = computeMetrics(ungrouped.positions, getBaselineRootId(ungrouped.positions));
  assert(
    flatMetrics.headcount === metrics.headcount && flatMetrics.totalCost === metrics.totalCost,
    "consolidating must change the shape, and no count or cost"
  );
  // The shape it changes, and the reason to want it: ungrouped, the Southern
  // managing director has nowhere to go but under the Northern chief
  // executive, inventing both a reporting line and a management layer that
  // exist nowhere in the client's organisation.
  const southernLead = ungrouped.positions.find((p) => p.displayName === "Priya Nair")!;
  const northernLead = ungrouped.positions.find((p) => p.displayName === "Dana Whitfield")!;
  assert(southernLead.managerId === northernLead.id, "fixture check: ungrouped, one brand lead is forced under the other");
  assert(flatMetrics.layers === 3 && metrics.layers === 2, `ungrouped should read as 3 layers and grouped as 2: got ${flatMetrics.layers} and ${metrics.layers}`);

  console.log(
    `\n6. Consolidated at brand level: ${headings.length} headings (Meridian Group → Northern, Southern), ` +
      `${metrics.headcount} positions · $${metrics.totalCost.toLocaleString()} — the same people and the same money as ungrouped.`
  );
  console.log(
    `   Ungrouped, the Southern lead is forced to report to the Northern chief executive: ${flatMetrics.layers} layers. ` +
      `Consolidated, each brand keeps its own top: ${metrics.layers}.`
  );

  // --- 7. headings can't be redesigned -----------------------------------
  const removal = remove(built.positions, rootId, northern.id);
  assert(removal.blocked, "removing a brand heading must be blocked — it would detach the whole brand");
  assert(removal.blockReason?.includes("heading"), `the block must explain itself: ${removal.blockReason}`);
  const move = reassign(built.positions, rootId, southern.id, northern.id);
  assert(move.blocked, "moving a brand heading under another must be blocked");
  console.log(`7. Headings are guarded: "${removal.blockReason}"`);

  // --- 8. no key means the instructions are recorded, never guessed at ---
  const unplanned = await planIngest("Consolidate at brand level.", [
    { filename: PAYROLL.filename, parsed: PAYROLL.parsed! },
  ]);
  if (hasAI()) {
    assert(unplanned?.source === "ai", "with a key configured the planner should return a real plan");
    console.log(`\n8. ANTHROPIC_API_KEY is set — planner returned a live plan from ${unplanned?.model}.`);
    console.log(`   notes: ${unplanned?.notes}`);
    console.log(`   groupBy: ${JSON.stringify(unplanned?.groupBy)}`);
  } else {
    assert(unplanned?.source === "unavailable", `without a key the plan must say so: got ${unplanned?.source}`);
    assert(unplanned.groupBy === null && unplanned.files.length === 0, "an unread instruction must change nothing");
    assert(unplanned.notes.includes("ANTHROPIC_API_KEY"), "the reason must name the missing key");
    console.log(`\n8. No key: instructions recorded, applied to nothing, and the reason is stated —`);
    console.log(`   "${unplanned.notes.slice(0, 108)}…"`);
  }

  // --- 9. no instructions must behave exactly as before ------------------
  const untouched = bindFiles([PAYROLL, CHART], null);
  assert(
    untouched.rows.length === naive.rows.length && untouched.groupBy === null,
    "an ingest with no instructions must be unchanged by this feature"
  );
  assert((await planIngest("   ", [{ filename: PAYROLL.filename, parsed: PAYROLL.parsed! }])) === null, "blank context must not call the model at all");
  console.log(`9. With the box left empty, nothing about ingest changes.`);

  console.log("\nALL PLAN CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
