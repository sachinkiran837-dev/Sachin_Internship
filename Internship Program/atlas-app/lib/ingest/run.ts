import { randomUUID } from "node:crypto";
import { UnsupportedFileError } from "./parseFile";
import { readSourceFile } from "./readSource";
import { bindFiles, type SourceFile } from "./bindFiles";
import { buildOrgGraph } from "./buildGraph";
import { planIngest, type IngestPlan } from "./plan";
import { costCoverage, reconcileGroups } from "./reconcile";
import type { IngestNote } from "./notes";
import type { IngestAnswers } from "./answers";
import {
  clearDerived,
  createOrg,
  saveAnswers,
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
  anonymize: boolean;
  answers: IngestAnswers;
  /**
   * Set when re-reading an establishment that already exists. Its id, and so
   * every link to it, survives the re-read; everything derived from the files
   * is rebuilt.
   */
  orgId?: string;
}

export type IngestResult = { orgId: string } | { error: string };

export async function runIngest(request: IngestRequest): Promise<IngestResult> {
  const { incoming, failures, context, anonymize, answers } = request;

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

  // Read the instructions *after* the files, because a plan can only be made
  // against what actually arrived: the planner is shown the real filenames,
  // the real columns and a few real rows, so it can say "the brand is the
  // Entity column" rather than inventing a column name. It decides roles and
  // meanings; every row operation below stays arithmetic.
  const plan = await planIngest(
    context,
    sources.filter((s) => s.parsed).map((s) => ({ filename: s.filename, parsed: s.parsed! }))
  );

  // One file binds to itself, so this path is the same for one upload or ten.
  const bound = bindFiles(sources, plan, answers);

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

  const { positions, issues } = await buildOrgGraph(bound, {
    orgId,
    anonymize,
    groupBy: bound.groupBy,
  });
  await savePositions(positions);

  // What each file turned out to contain, kept per file so the confirm screen
  // can answer questions about a specific upload rather than only about the
  // merged result.
  await saveSourceFiles(orgId, bound.bindings);

  // Everything Atlas assumed, and everything it refused to assume. The
  // vocabulary check runs last of all because it needs the files bound
  // together to see that two of them disagree.
  const notes: IngestNote[] = [...(bound.notes ?? [])];
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
