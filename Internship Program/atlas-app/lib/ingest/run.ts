import { randomUUID } from "node:crypto";
import { UnsupportedFileError } from "./parseFile";
import { readSourceFile } from "./readSource";
import { bindFiles, type SourceFile } from "./bindFiles";
import { buildOrgGraph } from "./buildGraph";
import { planIngest, type IngestPlan, type PriorRead } from "./plan";
import { appliedMapping, costCoverage, reconcileGroups } from "./reconcile";
import type { IngestNote } from "./notes";
import type { IngestAnswers } from "./answers";
import type { Position } from "@/lib/graph/types";
import { unitNames } from "@/lib/analysis/functions";
import { cleanRows, cleaningNote } from "@/lib/canonical/clean";
import { readBusinessContext } from "@/lib/hypothesis/read";
import { EMPTY_BUSINESS } from "@/lib/hypothesis/context";
import {
  clearDerived,
  createOrg,
  getBaselineRootId,
  saveAnswers,
  saveBusinessContext,
  saveCleaningLedger,
  saveIssues,
  saveNotes,
  savePositions,
  saveSourceBlobs,
  saveSourceFiles,
} from "@/db/repo";
import { SUPPORTED_FORMATS } from "./formats";

/**
 * The one path from a set of files to an establishment in the database.
 *
 * Both ways in run through here: the first upload, and every re-read after
 * the client answers a question Atlas raised. That is deliberate. An answer
 * like "a full-time week is 38 hours" changes what every hourly row costs,
 * which changes the coverage figures, which changes which questions are
 * still worth asking — and patching the saved positions instead would leave
 * the per-file report describing a read that no longer matches the map.
 * Re-reading the same bytes is the only version of "apply my correction"
 * that can't drift.
 */

export interface IngestRequest {
  /** The bytes to read, in upload order. */
  incoming: { filename: string; buffer: Buffer }[];
  /** Files that never arrived intact, reported alongside the ones that did. */
  failures: { filename: string; error: string }[];
  context: string;
  /**
   * The hypothesis layer, verbatim: what the client said about the business
   * rather than about the files. Read after the establishment is built, not
   * before, because a revenue figure can only be attached to a unit once the
   * units exist — and on a re-read the units may have changed, so it is read
   * again from the same words rather than carried forward.
   */
  hypothesis?: string;
  anonymize: boolean;
  answers: IngestAnswers;
  /**
   * Set when re-reading an establishment that already exists. Its id, and so
   * every link to it, survives the re-read; everything derived from the files
   * is rebuilt.
   */
  orgId?: string;
  /**
   * What Atlas concluded on the previous read. Given to the planner so a
   * correction written in prose is answered by a reader that can see what it
   * is correcting.
   */
  prior?: PriorRead | null;
}

/**
 * Folds the facts the planner read out of the client's own words into the
 * answers already on file, and says whether anything actually changed.
 *
 * A structured answer the client typed into a box wins over the same fact
 * inferred from a sentence — they filled in the field, which is a more direct
 * statement than prose about it. Everything the planner adds beyond that is
 * new information and is taken.
 */
function applyPlanAnswers(
  current: IngestAnswers,
  plan: IngestPlan | null
): IngestAnswers | null {
  if (!plan || plan.source !== "ai") return null;

  const hoursPerWeek = current.hoursPerWeek ?? plan.answers.hoursPerWeek;

  const valueMap: IngestAnswers["valueMap"] = { ...current.valueMap };
  for (const [column, pairs] of Object.entries(plan.answers.valueMap)) {
    valueMap[column] = { ...pairs, ...(valueMap[column] ?? {}) };
  }

  const changed =
    hoursPerWeek !== current.hoursPerWeek ||
    JSON.stringify(valueMap) !== JSON.stringify(current.valueMap);

  return changed ? { ...current, hoursPerWeek, valueMap } : null;
}

export type IngestResult = { orgId: string } | { error: string };

export async function runIngest(request: IngestRequest): Promise<IngestResult> {
  const { incoming, failures, context, anonymize, prior } = request;

  const read = async (answers: IngestAnswers): Promise<SourceFile[]> => {
    const sources: SourceFile[] = failures.map((f) => ({ filename: f.filename, error: f.error }));

    // Read every file, and record a failure as a property of that file rather
    // than throwing. One unreadable file among several is not a reason to
    // refuse the rest — and to a user, a refused batch is indistinguishable
    // from multi-file upload simply not working.
    for (const { filename, buffer } of incoming) {
      try {
        sources.push({ filename, parsed: await readSourceFile(filename, buffer, answers) });
      } catch (err) {
        sources.push({
          filename,
          error:
            err instanceof UnsupportedFileError
              ? err.message
              : `Reading this file failed: ${(err as Error).message}`,
        });
      }
    }

    return sources;
  };

  let answers = request.answers;
  let sources = await read(answers);

  // Read the instructions *after* the files, because a plan can only be made
  // against what actually arrived: the planner is shown the real filenames,
  // the real columns and a few real rows, so it can say "the brand is the
  // Entity column" rather than inventing a column name. When this run is a
  // correction, it is also shown what Atlas concluded last time, so a remark
  // like "the chart isn't the structure" has something to correct.
  const plan = await planIngest(
    context,
    sources.filter((s) => s.parsed).map((s) => ({ filename: s.filename, parsed: s.parsed! })),
    prior ?? null
  );

  // A plan can carry facts the client stated in prose — "a full-time week is
  // 38 hours", "NB is Northbrook". Those change what a file *means*, not just how
  // its files are bound, so the files have to be read again with them in
  // hand. One extra parse, no extra request, and it is the difference between
  // a correction that lands and one that is merely recorded.
  const revised = applyPlanAnswers(answers, plan);
  if (revised) {
    answers = revised;
    sources = await read(answers);
  }

  // One file binds to itself, so this path is the same for one upload or ten.
  const bound = bindFiles(sources, plan, answers);

  // The scrub, between binding and building. It runs here rather than per
  // file because a totals row is only recognisable once the columns have been
  // named — before that it is a row like any other with a number in it — and
  // because one ledger for the whole upload is what a person can actually
  // read, rather than one per file saying nothing much each.
  const { rows: cleanedRows, ledger } = cleanRows(bound.rows);
  bound.rows = cleanedRows;

  if (bound.rows.length === 0) {
    // Every reason, not just the first — if four files failed for four
    // different reasons, one error message naming one of them sends the user
    // round the loop three more times.
    const reasons = sources.filter((s) => s.error).map((s) => `${s.filename} — ${s.error}`);
    return {
      error:
        (reasons.length > 0 ? `${reasons.join("\n\n")}\n\n` : "") +
        "Atlas needs at least one file with a role or job title in it, plus a position ID, name or manager to identify each row.",
    };
  }

  const rereading = Boolean(request.orgId);
  let orgId = request.orgId ?? "";

  if (rereading) {
    await clearDerived(orgId);
    await saveAnswers(orgId, answers, plan, context);
  } else {
    orgId = await createOrg({
      name: orgNameFor(sources),
      sourceFilename: sources.map((s) => s.filename).join(", "),
      anonymized: anonymize,
      ingestContext: context,
      plan,
    });
    // Kept so a later correction can re-read exactly these bytes instead of
    // asking the client to find the files again.
    await saveSourceBlobs(orgId, incoming);
  }

  const { positions, issues, notes: graphNotes } = await buildOrgGraph(bound, {
    orgId,
    anonymize,
    groupBy: bound.groupBy,
  });
  await savePositions(positions);

  // The hypothesis layer, read against the establishment that now exists.
  // Nothing in it touches the map or the positions — it decides what the
  // findings can say, which is why it is read here and applied later.
  await saveBusinessContext(orgId, await readHypothesis(request.hypothesis, positions));

  // What each file turned out to contain, kept per file so the confirm screen
  // can answer questions about a specific upload rather than only about the
  // merged result.
  await saveSourceFiles(orgId, bound.bindings);

  // Kept because it is the one thing on the canonical-table screen that
  // cannot be re-derived: the saved establishment is what survived the scrub,
  // and says nothing about what didn't.
  await saveCleaningLedger(orgId, ledger);

  // Everything Atlas assumed, and everything it refused to assume. The
  // vocabulary check runs last of all because it needs the files bound
  // together to see that two of them disagree.
  const notes: IngestNote[] = [...(bound.notes ?? []), ...graphNotes];
  const scrubbed = cleaningNote(ledger);
  if (scrubbed) notes.push(scrubbed);
  const merged = appliedMapping(bound, answers, revised !== null);
  if (merged) notes.push(merged);
  const vocabulary = await reconcileGroups(bound, answers);
  if (vocabulary) notes.push(vocabulary);
  const coverage = costCoverage(positions);
  if (coverage) notes.push(coverage);
  await saveNotes(orgId, ordered(notes));

  await saveIssues([
    ...conversionIssues(orgId, sources, bound),
    ...planWarnings(orgId, plan, bound.filteredOut),
    ...reviewIssues(orgId, sources),
    ...issues,
  ]);

  return { orgId };
}

/**
 * Turns what the client wrote about their business into facts the findings
 * can compute against, naming the units this establishment actually has so a
 * figure can never be attached to a part of the business that isn't there.
 *
 * A failure here is not a failure of the ingest. The establishment is already
 * saved and correct; all that is lost is the framing, so the context is stored
 * as prose and the screens say the figures could not be read out of it.
 */
async function readHypothesis(raw: string | undefined, positions: Position[]) {
  const text = (raw ?? "").trim();
  if (text.length === 0) return EMPTY_BUSINESS;
  try {
    return await readBusinessContext(text, unitNames(positions, getBaselineRootId(positions)));
  } catch (err) {
    return {
      ...EMPTY_BUSINESS,
      raw: text,
      unmatched: [`Atlas kept what you wrote but could not read figures out of it: ${(err as Error).message}`],
    };
  }
}

/**
 * Questions before assumptions. A question is a gap the client has to close;
 * an assumption is settled unless they disagree with it, and burying the
 * first under the second is how a confirm screen stops being read.
 */
function ordered(notes: IngestNote[]): IngestNote[] {
  return [...notes].sort((a, b) => Number(b.kind === "question") - Number(a.kind === "question"));
}

/**
 * What Atlas did to each file — the conversion and, when there is more than
 * one, how it was bound to the others. A file that contributed nothing has to
 * say so.
 */
function conversionIssues(
  orgId: string,
  sources: SourceFile[],
  bound: ReturnType<typeof bindFiles>
) {
  return [
    {
      id: randomUUID(),
      orgId,
      kind: "conversion" as const,
      positionId: null,
      detail: `${bound.conversion.sourceFormat} · ${bound.conversion.detail} ${bound.conversion.rowCount} row${
        bound.conversion.rowCount === 1 ? "" : "s"
      } and ${bound.headers.length} column${bound.headers.length === 1 ? "" : "s"} in the combined establishment.`,
      resolved: true,
    },
    // Per-file lines whenever there is more than one file, and always when a
    // file was rejected — a single refused file must never be silent just
    // because it was the only one.
    ...(sources.length > 1 || sources.some((s) => s.error)
      ? bound.bindings.map((b) => ({
          id: randomUUID(),
          orgId,
          kind: "conversion" as const,
          positionId: null,
          detail: `${b.filename} — ${b.detail}`,
          // An unusable file is a real gap the reviewer should see, not a
          // settled fact, so it stays unresolved.
          resolved: b.role !== "unusable",
        }))
      : []),
  ];
}

/**
 * Rows a model transcribed from a picture are the one kind of ingest that
 * isn't a reading of someone else's export, so they land in the same
 * low-confidence queue as an unresolved reporting line.
 */
function reviewIssues(orgId: string, sources: SourceFile[]) {
  return sources
    .filter((s) => s.parsed?.conversion.needsReview)
    .map((s) => ({
      id: randomUUID(),
      orgId,
      kind: "low_confidence" as const,
      positionId: null,
      detail: s.parsed!.conversion.needsReview!,
      resolved: false,
    }));
}

/**
 * The parts of the instructions that could not be honoured, plus the scope
 * they narrowed. Both belong on the confirm screen: a filter that quietly
 * removed 300 rows and a filter that was silently ignored look identical from
 * the map, and they call for opposite responses.
 */
function planWarnings(orgId: string, plan: IngestPlan | null, filteredOut: number) {
  if (!plan) return [];

  const issues = plan.warnings.map((detail) => ({
    id: randomUUID(),
    orgId,
    kind: "conversion" as const,
    positionId: null,
    detail: `From your instructions: ${detail}`,
    resolved: false,
  }));

  if (filteredOut > 0 && plan.rowFilter) {
    const { column, include, exclude } = plan.rowFilter;
    issues.push({
      id: randomUUID(),
      orgId,
      kind: "conversion" as const,
      positionId: null,
      detail:
        `Scope from your instructions: ${filteredOut} row${filteredOut === 1 ? " was" : "s were"} left out before anything was bound, ` +
        `on the "${column}" column — ` +
        (include.length > 0 ? `keeping only ${include.join(", ")}` : "") +
        (include.length > 0 && exclude.length > 0 ? ", and " : "") +
        (exclude.length > 0 ? `dropping ${exclude.join(", ")}` : "") +
        `. Every count and cost on the following screens is of what remained.`,
      resolved: true,
    });
  }

  return issues;
}

/** Named after the first file that actually contributed, not the first uploaded. */
function orgNameFor(sources: SourceFile[]): string {
  const used = sources.filter((s) => s.parsed);
  const first = stripExtension((used[0] ?? sources[0]).filename);
  return used.length <= 1 ? first : `${first} + ${used.length - 1} more`;
}

function stripExtension(filename: string): string {
  for (const { ext } of SUPPORTED_FORMATS) {
    if (filename.toLowerCase().endsWith(ext)) return filename.slice(0, -ext.length);
  }
  return filename;
}
