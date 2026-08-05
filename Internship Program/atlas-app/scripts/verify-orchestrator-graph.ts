/**
 * Checks the orchestrator's dependency graph — who's a leaf, who fans in from
 * whom, who is deliberately independent — against the real import statements
 * in each file, rather than trusting the design doc to stay correct on its
 * own. The graph lives in
 * `/Users/sachinkiran/.claude/plans/replicated-herding-willow.md`; this is
 * what stops that document from drifting the moment someone adds an import.
 *
 * Run with `npx tsx scripts/verify-orchestrator-graph.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

/** Every module specifier a file imports from, `@/...` and relative alike. */
function importsOf(relPath: string): Set<string> {
  const source = readFileSync(join(ROOT, relPath), "utf8");
  const specifiers = new Set<string>();
  for (const m of source.matchAll(/from\s+["']([^"']+)["']/g)) {
    specifiers.add(m[1]);
  }
  return specifiers;
}

/** Resolves a relative specifier (e.g. "./guardrails" from lib/scenario/x.ts) to its @/-style form. */
function resolve(fromFile: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  const dir = fromFile.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === ".") continue;
    if (part === "..") dir.pop();
    else dir.push(part);
  }
  return "@/" + dir.join("/");
}

function dependsOn(file: string, target: string): boolean {
  const targets = importsOf(file);
  for (const spec of targets) {
    if (resolve(file, spec) === target) return true;
  }
  return false;
}

interface Edge {
  file: string;
  requires: string[];
  forbids?: string[];
}

// One row per edge asserted in the design doc's dependency graph.
const EDGES: Edge[] = [
  // Layer 1 — leaves off A only.
  { file: "lib/analysis/footprint.ts", requires: ["@/lib/analysis/functions"] },
  { file: "lib/analysis/vacancyHygiene.ts", requires: [], forbids: ["@/lib/analysis/functions"] },
  { file: "lib/analysis/workforceMix.ts", requires: [], forbids: ["@/lib/analysis/functions"] },
  { file: "lib/analysis/keyPersonRisk.ts", requires: [], forbids: ["@/lib/analysis/functions"] },
  { file: "lib/analysis/irEbaOverlay.ts", requires: [], forbids: ["@/lib/analysis/functions"] },

  // Layer 2.
  { file: "lib/analysis/duplication.ts", requires: ["@/lib/analysis/footprint"] },
  { file: "lib/analysis/backOfficeBenchmarks.ts", requires: ["@/lib/analysis/functions"] },
  {
    file: "lib/analysis/contingentReliance.ts",
    requires: ["@/lib/analysis/functions", "@/lib/analysis/vacancyHygiene"],
  },

  // Layer 3 — the design doc's headline correction: F is not an independent leaf.
  { file: "lib/analysis/productivity.ts", requires: ["@/lib/analysis/backOfficeBenchmarks"] },
  {
    file: "lib/analysis/peerBenchmark.ts",
    requires: [
      "@/lib/analysis/backOfficeBenchmarks",
      "@/lib/analysis/functions",
      "@/lib/analysis/contingentReliance",
    ],
  },

  // Layer 4 — the design doc's other correction: G needs E and F directly, not just "B-F as a block".
  {
    file: "lib/hypothesis/build.ts",
    requires: [
      "@/lib/metrics/diagnostics",
      "@/lib/analysis/footprint",
      "@/lib/analysis/duplication",
      "@/lib/analysis/backOfficeBenchmarks",
      "@/lib/analysis/productivity",
      "@/lib/analysis/vacancyHygiene",
      "@/lib/analysis/contingentReliance",
      "@/lib/analysis/workforceMix",
      "@/lib/analysis/keyPersonRisk",
      "@/lib/analysis/peerBenchmark",
    ],
  },
  { file: "lib/scenario/reconcile.ts", requires: ["@/lib/analysis/irEbaOverlay"] },

  // Layer 5 — H1 is independent of G; H2/H3 depend on B/E, not G.
  {
    file: "lib/scenario/patterns.ts",
    requires: ["@/lib/graph/tagging"],
    forbids: ["@/lib/hypothesis/build", "@/lib/scenario/reconcile"],
  },
  {
    file: "lib/scenario/impact.ts",
    requires: ["@/lib/metrics/diagnostics", "@/lib/analysis/keyPersonRisk"],
    forbids: ["@/lib/hypothesis/build"],
  },
  { file: "lib/scenario/phasing.ts", requires: ["@/lib/scenario/impact", "@/lib/analysis/irEbaOverlay"] },

  // Layer 6 — I3 (Ask Atlas) deliberately does not fan in from G.
  {
    file: "lib/ask/interpret.ts",
    requires: ["@/lib/metrics/diagnostics", "@/lib/analysis/keyPersonRisk", "@/lib/scenario/patterns"],
    forbids: ["@/lib/hypothesis/build", "@/lib/scenario/reconcile"],
  },
];

function main() {
  console.log("Checking the orchestrator dependency graph against real imports\n");

  let checked = 0;
  for (const edge of EDGES) {
    for (const req of edge.requires) {
      assert(
        dependsOn(edge.file, req),
        `${edge.file} was expected to import from ${req} (per the dependency graph) but does not`
      );
      checked++;
    }
    for (const forbidden of edge.forbids ?? []) {
      assert(
        !dependsOn(edge.file, forbidden),
        `${edge.file} was expected to be independent of ${forbidden} but imports it — the graph's claim of independence is wrong`
      );
      checked++;
    }
  }
  console.log(`${checked} edges checked across ${EDGES.length} files — all match the documented graph.\n`);

  // The two corrections called out explicitly in the design doc.
  assert(
    dependsOn("lib/analysis/peerBenchmark.ts", "@/lib/analysis/backOfficeBenchmarks") &&
      dependsOn("lib/analysis/peerBenchmark.ts", "@/lib/analysis/contingentReliance"),
    "F (peerBenchmark) should depend on C and D — it is not an independent leaf"
  );
  console.log("Confirmed: F (peerBenchmark) is not an independent leaf — it needs C and D first.");

  assert(
    dependsOn("lib/hypothesis/build.ts", "@/lib/analysis/keyPersonRisk") &&
      dependsOn("lib/hypothesis/build.ts", "@/lib/analysis/peerBenchmark"),
    "G (hypothesis/build) should depend directly on E and F, not just 'B-F as a block'"
  );
  console.log("Confirmed: G depends directly on E and F — 5-6-7 (E, F, G) cannot run in parallel.\n");

  console.log("verify-orchestrator-graph PASS");
}

main();
