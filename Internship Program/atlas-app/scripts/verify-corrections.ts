/**
 * The loop that makes Atlas's refusals honest.
 *
 * Atlas is allowed to leave 652 people uncosted and two brand vocabularies
 * unreconciled *because* there is a way for the client to say what the files
 * couldn't, and for the saying to reach the numbers. Without that, a refusal
 * is just a hole with a paragraph next to it.
 *
 * So what is checked here is the round trip: ingest, see what Atlas would not
 * guess, answer it the way the confirm screen does, and confirm the answer
 * reaches the map — the same establishment, the same id, read again from the
 * same bytes, with the questions closed and named as the client's.
 *
 * Run with `npx tsx --env-file=.env.local scripts/verify-corrections.ts`.
 */
import { runIngest } from "../lib/ingest/run";
import { EMPTY_ANSWERS, mergeAnswers } from "../lib/ingest/answers";
import {
  clearDerived,
  getAnswers,
  getBaselinePositions,
  getNotes,
  getOrg,
  getSourceBlobs,
  saveAnswers,
} from "../db/repo";
import { db } from "../db/client";
import { orgs, sourceBlobs } from "../db/schema";
import { eq } from "drizzle-orm";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.join(",")).join("\n"), "utf8");

/** Frontline staff, paid by the hour, brand written out in full. */
const WORKFORCE = csv([
  ["Employee ID", "Employee Name", "Job Title", "BRAND", "FTE", "Rate", "RateUnit"],
  ["W1", "Alicia Byrnes", "Care Companion", "365 Care", "0.8", "36.23", "Hourly"],
  ["W2", "Josephine Sallows", "Care Companion", "365 Care", "0.6", "36.23", "Hourly"],
  ["W3", "Alice Chama", "Home Support Worker", "Accept Care", "0.8", "32.72", "Hourly"],
  ["W4", "Andre Jedamski", "Home Support Worker", "Accept Care", "1.0", "33.73", "Hourly"],
]);

/** Head office, salaried, brand written as a code. */
const PAYROLL = csv([
  ["Position ID", "Employee / Position", "Role", "Source Brand", "FTE", "Annual Salary"],
  ["H1", "Norbert Walther", "Group CEO", "365C", "1.00", "260000"],
  ["H2", "Ashna Varma", "Workforce Coordinator", "365C", "1.00", "80000"],
  ["H3", "Debora Gerungan", "Administration", "ACG", "1.00", "74000"],
]);

const CONTEXT =
  "Two brands, recorded differently in each file. Consolidate at brand level using the brand column in each.";

async function main() {
  // --- 1. first read: Atlas refuses to guess ------------------------------
  const first = await runIngest({
    incoming: [
      { filename: "workforce.csv", buffer: WORKFORCE },
      { filename: "payroll.csv", buffer: PAYROLL },
    ],
    failures: [],
    context: CONTEXT,
    anonymize: false,
    answers: EMPTY_ANSWERS,
  });
  assert(!("error" in first), `the first read must succeed: ${JSON.stringify(first)}`);
  const orgId = (first as { orgId: string }).orgId;

  try {
    const before = await getBaselinePositions(orgId);
    const realBefore = before.filter((p) => !p.synthetic);
    assert(realBefore.length === 7, `expected 7 people, got ${realBefore.length}`);

    const uncosted = realBefore.filter((p) => p.cost <= 0);
    assert(uncosted.length === 4, `the 4 hourly staff must be left uncosted, got ${uncosted.length}`);

    const notes = await getNotes(orgId);
    const hours = notes.find((n) => n.id === "paid-hours");
    assert(hours?.kind === "question" && hours.answerKind === "hours", "the hours gap must be an answerable question");

    const vocabulary = notes.find((n) => n.id === "group-vocabulary");
    assert(vocabulary?.kind === "question", "two vocabularies for one dimension must be raised, not merged");
    assert(vocabulary.options.length > 0, "the question must arrive with a proposal to accept or correct");

    const groupsBefore = before.filter((p) => p.synthetic).length;
    console.log(
      `1. First read: ${realBefore.length} people, ${uncosted.length} uncosted, ${groupsBefore} headings, ` +
        `${notes.filter((n) => n.kind === "question").length} questions.`
    );
    for (const o of vocabulary.options) console.log(`     proposed: ${o.from} → ${o.to || "(nothing)"}`);

    // --- 2. answer them exactly as the confirm screen does ---------------
    const form = new FormData();
    form.set("hoursPerWeek", "38");
    // Named exactly as the screen names them, so what is exercised is the
    // field the client actually submits.
    const dimension = vocabulary.options[0].seenIn;
    // The client accepts Atlas's pairing for one and corrects the other by
    // hand — both routes have to work, or the proposal is really a decision.
    form.set(`map:${dimension}:365C`, "365 Care");
    form.set(`map:${dimension}:ACG`, "Accept Care");
    form.set("extraContext", "");

    const answers = mergeAnswers(await getAnswers(orgId), form);
    assert(answers.hoursPerWeek === 38, "the hours answer must survive the merge");

    const again = await runIngest({
      orgId,
      incoming: await getSourceBlobs(orgId),
      failures: [],
      context: CONTEXT,
      anonymize: false,
      answers,
    });
    assert(!("error" in again), `the re-read must succeed: ${JSON.stringify(again)}`);
    assert((again as { orgId: string }).orgId === orgId, "a re-read must keep the establishment's identity");

    // --- 3. the answers reached the numbers -------------------------------
    const after = await getBaselinePositions(orgId);
    const realAfter = after.filter((p) => !p.synthetic);
    assert(realAfter.length === 7, `the same people must come back, got ${realAfter.length}`);
    assert(
      realAfter.every((p) => p.cost > 0),
      `every position must now be priced: ${realAfter.filter((p) => p.cost <= 0).length} still at $0`
    );

    const alicia = realAfter.find((p) => p.displayName === "Alicia Byrnes")!;
    assert(
      Math.round(alicia.cost) === Math.round(36.23 * 38 * 52),
      `an hourly worker must be priced on the client's hours, held full-time: got ${alicia.cost}`
    );

    const headings = after.filter((p) => p.synthetic).map((p) => p.title).sort();
    assert(
      headings.filter((h) => h === "365C" || h === "ACG").length === 0,
      `a reconciled code must not survive as its own group: ${headings.join(", ")}`
    );
    assert(
      headings.includes("365 Care") && headings.includes("Accept Care"),
      `both brands must survive as groups: ${headings.join(", ")}`
    );

    const reread = await getNotes(orgId);
    const settled = reread.find((n) => n.id === "paid-hours")!;
    assert(
      settled.kind === "assumption" && settled.answeredWith === "38 hours a week",
      "an answered question must come back as an assumption naming the client as its source"
    );
    assert(
      !reread.some((n) => n.id === "group-vocabulary"),
      "a reconciled vocabulary must stop being asked about"
    );

    const org = await getOrg(orgId);
    assert(org?.revision === 1, `the re-read must be recorded: revision ${org?.revision}`);
    assert((await getAnswers(orgId)).hoursPerWeek === 38, "the answers must persist for the next re-read");

    console.log(
      `2. Answered 38h and paired 365C → 365 Care, ACG → Accept Care.\n` +
        `3. Re-read the same bytes into the same establishment: ${realAfter.length} people all priced, ` +
        `headings now ${headings.join(" | ")}, ${reread.filter((n) => n.kind === "question").length} questions left.`
    );

    console.log("\nALL CORRECTION CHECKS PASSED");
  } finally {
    // The fixture establishment is a test artefact, not a client's work.
    await clearDerived(orgId);
    await saveAnswers(orgId, EMPTY_ANSWERS, null, "");
    await db.delete(sourceBlobs).where(eq(sourceBlobs.orgId, orgId));
    await db.delete(orgs).where(eq(orgs.id, orgId));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
