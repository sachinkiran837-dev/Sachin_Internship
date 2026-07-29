/**
 * The hypothesis layer, end to end.
 *
 * What is checked here is the discipline, not the arithmetic. Any engine can
 * divide revenue by headcount. The things that make this one usable in front
 * of a client are the refusals: that it will not compare a unit too small to
 * mean anything, will not invent a revenue figure, will not attach one to a
 * part of the business that doesn't exist, and — the one that matters most —
 * will tell a client their own hypothesis is wrong when the data says so.
 *
 * A tool that only ever confirms what it was told is a mirror with a licence
 * fee, so the central case here is deliberately the uncomfortable one: a
 * client asserts a function is over-managed, and the establishment says it
 * isn't.
 *
 * Runs entirely in memory against a built fixture. No database, no network,
 * no key required.
 *
 * Run with `npx tsx scripts/verify-hypotheses.ts`.
 */
import { randomUUID } from "node:crypto";
import {
  agencyConcentration,
  analyseFunctions,
  managementOutliers,
  productivitySpread,
  unitNames,
} from "../lib/analysis/functions";
import { buildHypotheses } from "../lib/hypothesis/build";
import { EMPTY_BUSINESS, type BusinessContext } from "../lib/hypothesis/context";
import type { Position } from "../lib/graph/types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

const ORG = "fixture";

function pos(over: Partial<Position> & { title: string; department: string }): Position {
  return {
    id: randomUUID(),
    orgId: ORG,
    rawName: null,
    displayName: over.title,
    functionGroup: over.department,
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

/**
 * Two functions of the same size, built so the comparison has exactly one
 * right answer.
 *
 * Operations runs 12 people under 2 managers. Platform runs 12 under 6. Both
 * clear the minimum size, so neither can be dismissed, and the difference is
 * the only thing between them.
 */
function buildFixture() {
  const ceo = pos({ title: "Chief Executive", department: "Executive", cost: 300_000 });

  const positions: Position[] = [ceo];

  const build = (dept: string, managerCount: number, staffCount: number, staffCost: number) => {
    const head = pos({ title: `${dept} Director`, department: dept, managerId: ceo.id, cost: 200_000 });
    positions.push(head);
    const managers = Array.from({ length: managerCount }, (_, i) =>
      pos({ title: `${dept} Manager ${i + 1}`, department: dept, managerId: head.id, cost: 130_000 })
    );
    positions.push(...managers);
    for (let i = 0; i < staffCount; i++) {
      positions.push(
        pos({
          title: `${dept} Officer ${i + 1}`,
          department: dept,
          managerId: managers[i % managers.length].id,
          cost: staffCost,
        })
      );
    }
    return head;
  };

  // 12 staff, 2 managers + 1 director = 3 of 15 → 20% management.
  build("Operations", 2, 12, 80_000);
  // 12 staff, 6 managers + 1 director = 7 of 19 → 37% management.
  build("Platform", 6, 12, 80_000);
  // A third comparable function so the median is a median of three, and it
  // sits between the other two rather than beside either.
  build("Care", 3, 12, 80_000);
  // Too small to compare — must appear in the table and in no median.
  positions.push(pos({ title: "Legal Counsel", department: "Legal", managerId: ceo.id }));

  return { positions, rootId: ceo.id };
}

function main() {
  const { positions, rootId } = buildFixture();

  /* --- 1. the comparison picks the right cut and the right outlier ----- */

  const { primary, choice } = analyseFunctions(positions, rootId, EMPTY_BUSINESS);
  assert(primary.dimension === "function", `a full department column must be used as the cut, got ${primary.dimension}`);
  assert(primary.usable, `the cut must be usable: ${primary.limitation}`);

  const small = primary.units.find((u) => u.key === "Legal")!;
  assert(small !== undefined, "a unit too small to compare must still appear in the table");
  assert(!small.comparable, "a one-person function must not be treated as comparable");
  assert(
    !primary.comparableUnits.some((u) => u.key === "Legal"),
    "a unit too small to compare must not be in the median"
  );

  const outliers = managementOutliers(primary);
  assert(outliers.length === 1, `exactly one function is over-managed here, got ${outliers.length}`);
  assert(outliers[0].unit.key === "Platform", `the over-managed function is Platform, got ${outliers[0].unit.key}`);
  assert(
    outliers[0].excessManagers >= 1 && outliers[0].excessCost !== null && outliers[0].excessCost > 0,
    `the gap must be expressed in roles and priced: ${JSON.stringify(outliers[0])}`
  );

  console.log(
    `1. Cut: ${choice.split(".")[0]}.\n` +
      `   ${primary.comparableUnits.length} comparable functions, median management share ` +
      `${((primary.medians.managerShare ?? 0) * 100).toFixed(0)}%.\n` +
      `   Called out: ${outliers.map((o) => `${o.unit.key} at ${(o.unit.managerShare * 100).toFixed(0)}% (${o.excessManagers} roles, ${Math.round(o.excessCost ?? 0).toLocaleString()})`).join("; ")}`
  );

  /* --- 2. no revenue means no revenue figures, ever -------------------- */

  assert(productivitySpread(primary) === null, "revenue per head must be unavailable when no revenue was supplied");
  assert(
    primary.units.every((u) => u.revenue === null && u.revenuePerHead === null),
    "no unit may carry a revenue figure Atlas was not given"
  );

  const bare = buildHypotheses(positions, rootId, EMPTY_BUSINESS);
  const askingForRevenue = bare.hypotheses.find((h) => h.id === "productivity:needs-revenue");
  assert(askingForRevenue, "with no revenue supplied, Atlas must say so rather than say nothing");
  assert(
    askingForRevenue.strength === "needs-input" && askingForRevenue.prize.amount === null,
    "a hypothesis Atlas cannot size must not carry a number"
  );
  assert(
    bare.wouldUnlock.some((u) => u.toLowerCase().includes("revenue")),
    "the missing input must be named as something that would unlock more"
  );

  // Every hypothesis has to carry all three parts, or the shape is a lie.
  for (const h of bare.hypotheses) {
    assert(h.thinking.trim().length > 0, `"${h.title}" has no diagnosis`);
    assert(h.action.trim().length > 0, `"${h.title}" has no action`);
    assert(h.prize.statement.trim().length > 0, `"${h.title}" has no stated prize`);
    assert(h.conditions.length > 0, `"${h.title}" states no conditions — every claim here has some`);
  }

  const load = bare.hypotheses.find((h) => h.id === "management-load:Platform");
  assert(load, "the over-managed function must surface as a hypothesis");
  assert(load.playId !== null, "an action must point at the play that models it");

  console.log(
    `2. With no revenue supplied: ${bare.hypotheses.length} hypotheses, all three-part, ` +
      `${bare.hypotheses.filter((h) => h.prize.amount !== null).length} priced, and revenue per head refused.`
  );

  /* --- 3. revenue supplied by the client changes what can be said ------ */

  const withRevenue: BusinessContext = {
    ...EMPTY_BUSINESS,
    raw: "Operations did 12m, Platform 4m, Care 9m. We need 250k out by FY27.",
    revenue: [
      { unit: "Operations", amount: 12_000_000, period: "FY26", statedAs: "Operations did 12m" },
      { unit: "Platform", amount: 4_000_000, period: "FY26", statedAs: "Platform 4m" },
      { unit: "Care", amount: 9_000_000, period: "FY26", statedAs: "Care 9m" },
    ],
    targets: [
      { measure: "cost", amount: 250_000, horizon: "FY27", statedAs: "We need 250k out by FY27" },
    ],
    source: "ai",
  };

  const spread = productivitySpread(analyseFunctions(positions, rootId, withRevenue).primary)!;
  assert(spread, "three revenue figures must produce a ranking");
  assert(spread.best.key === "Operations", `Operations earns the most per head, got ${spread.best.key}`);
  assert(spread.worst.key === "Platform", `Platform earns the least per head, got ${spread.worst.key}`);
  assert(spread.gapAtMedian > 0, "the lagging unit's gap to the median must be quantified");

  const revenueRun = buildHypotheses(positions, rootId, withRevenue);
  const productivity = revenueRun.hypotheses.find((h) => h.id === "productivity:spread");
  assert(productivity, "with revenue supplied, the spread must be reported");
  assert(
    productivity.prize.nature === "capacity",
    "revenue a lagging unit would carry at the median is capacity, not a cost saving"
  );
  assert(
    productivity.conditions.some((c) => c.includes("Operations did 12m")),
    "the client's own words must travel with the figures they produced"
  );

  const target = revenueRun.hypotheses.find((h) => h.id === "target:cost");
  assert(target, "a stated cost target must be measured against what was found");
  assert(
    target.conditions.some((c) => c.toLowerCase().includes("must not be summed")),
    "the overlap rule must travel with any comparison against a target"
  );

  console.log(
    `3. With revenue supplied: ${spread.best.key} at ${Math.round(spread.best.revenuePerHead!).toLocaleString()}/head ` +
      `vs ${spread.worst.key} at ${Math.round(spread.worst.revenuePerHead!).toLocaleString()}/head ` +
      `(median ${Math.round(spread.median).toLocaleString()}); gap at median ${Math.round(spread.gapAtMedian).toLocaleString()}.`
  );

  /* --- 4. the client is told when they are wrong ----------------------- */

  const beliefs: BusinessContext = {
    ...EMPTY_BUSINESS,
    raw: "…",
    beliefs: [
      { unit: "Platform", about: "management", statedAs: "Platform is over-managed" },
      { unit: "Operations", about: "management", statedAs: "Operations is over-managed too" },
      { unit: "Care", about: "productivity", statedAs: "Care isn't pulling its weight" },
      { unit: "Legal", about: "management", statedAs: "Legal has too many chiefs" },
    ],
    source: "ai",
  };

  const tested = buildHypotheses(positions, rootId, beliefs).hypotheses.filter((h) => h.verdict !== null);
  assert(tested.length === 4, `every belief must come back with a verdict, got ${tested.length}`);

  const verdicts = new Map(tested.map((h) => [h.unit, h.verdict] as const));
  assert(
    verdicts.get("Platform") === "supported",
    `Platform really is over-managed, so the verdict must be supported: got ${verdicts.get("Platform")}`
  );
  // The one that earns the tool its keep.
  assert(
    verdicts.get("Operations") === "not supported",
    `Operations runs below the median, so Atlas must contradict the client: got ${verdicts.get("Operations")}`
  );
  assert(
    verdicts.get("Care") === "untestable",
    `a productivity claim with no revenue supplied cannot be settled: got ${verdicts.get("Care")}`
  );
  assert(
    verdicts.get("Legal") === "untestable",
    `a one-person function is too small to judge: got ${verdicts.get("Legal")}`
  );

  const contradicted = tested.find((h) => h.unit === "Operations")!;
  assert(
    contradicted.thinking.startsWith("The data does not support it"),
    `a contradiction must lead with the contradiction, not bury it: "${contradicted.thinking.slice(0, 60)}…"`
  );
  assert(
    tested.every((h) => h.title.startsWith("You said:")),
    "a tested belief must be quoted back so the client can see what was tested"
  );

  console.log(
    `4. Beliefs tested: ` +
      tested.map((h) => `${h.unit} ${h.verdict}`).join(", ")
  );

  /* --- 5. a figure for a unit that doesn't exist is never attached ----- */

  const names = unitNames(positions, rootId);
  assert(names.includes("Platform") && names.includes("Operations"), `unit names must be offered: ${names.join(", ")}`);
  assert(!names.includes("Retail"), "unitNames must only report units that exist");

  const misattributed = analyseFunctions(positions, rootId, {
    ...EMPTY_BUSINESS,
    revenue: [{ unit: "Retail", amount: 50_000_000, period: "FY26", statedAs: "Retail did 50m" }],
    source: "ai",
  });
  assert(
    misattributed.primary.units.every((u) => u.revenue === null),
    "revenue named against a unit that does not exist must reach no unit at all"
  );

  /* --- 6. agency concentration is found where it actually is ----------- */

  const withAgency = positions.map((p, i) =>
    p.department === "Platform" && p.title.includes("Officer") && i % 2 === 0
      ? { ...p, status: "contingent" as const, fte: 0 }
      : p
  );
  const agency = agencyConcentration(analyseFunctions(withAgency, rootId, EMPTY_BUSINESS).primary);
  assert(agency.length > 0 && agency[0].key === "Platform", `agency concentration must be located: ${agency.map((u) => u.key).join(", ")}`);

  console.log(
    `5. A revenue figure for a unit that doesn't exist reached nothing.\n` +
      `6. Agency concentration located in ${agency[0].key} at ${(agency[0].agencyShare * 100).toFixed(0)}%.`
  );

  /* --- 7. a median of zero is not a benchmark -------------------------- */

  // The trap this is guarding. Where most units carry no managers — usually
  // because the reporting lines inside them never reached Atlas, not because
  // the organisation is flat — the median management share is zero, and
  // "above the median" becomes true of any unit with a single manager. A tool
  // that confirmed a client's suspicion off that is a tool that agrees with
  // whatever it is told, which is worth nothing to the person paying for it.
  const flatCeo = pos({ title: "Chief Executive", department: "Executive", cost: 300_000 });
  const flat: Position[] = [flatCeo];
  for (const dept of ["Brand A", "Brand B", "Brand C"]) {
    for (let i = 0; i < 10; i++) {
      flat.push(pos({ title: `${dept} Carer ${i + 1}`, department: dept, managerId: flatCeo.id }));
    }
  }
  // One unit with a single manager — the one a zero median would wave through.
  const lead = pos({ title: "Brand D Lead", department: "Brand D", managerId: flatCeo.id });
  flat.push(lead);
  for (let i = 0; i < 9; i++) {
    flat.push(pos({ title: `Brand D Carer ${i + 1}`, department: "Brand D", managerId: lead.id }));
  }

  const flatComparison = analyseFunctions(flat, flatCeo.id, EMPTY_BUSINESS).primary;
  assert(
    (flatComparison.medians.managerShare ?? 0) === 0,
    "the fixture must actually produce a zero median, or this check proves nothing"
  );
  assert(
    managementOutliers(flatComparison).length === 0,
    "nothing may be called over-managed against a median of zero"
  );

  const flatBelief = buildHypotheses(flat, flatCeo.id, {
    ...EMPTY_BUSINESS,
    raw: "…",
    beliefs: [{ unit: "Brand D", about: "management", statedAs: "Brand D is over-managed" }],
    source: "ai",
  });
  const unsettled = flatBelief.hypotheses.find((h) => h.verdict !== null)!;
  assert(
    unsettled.verdict === "untestable",
    `against a zero median a belief must not be confirmed: got "${unsettled.verdict}"`
  );
  assert(
    flatBelief.wouldUnlock.some((u) => u.toLowerCase().includes("reporting lines")),
    "the missing reporting lines must be named as the thing that would make it answerable"
  );

  console.log(
    `7. Against a median of zero: nothing called out, the client's belief returned untestable, ` +
      `and the missing reporting lines named as the cause.`
  );

  console.log("\nALL HYPOTHESIS CHECKS PASSED");
}

main();
