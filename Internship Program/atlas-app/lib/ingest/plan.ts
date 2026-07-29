import { ask, hasAI } from "@/lib/ai/client";
import { CANONICAL_FIELDS } from "@/lib/graph/types";
import type { ParsedFile } from "./parseFile";
import { COMPOSED_COST, COMPOSED_NAME } from "./composeColumns";

/**
 * Turns a sentence of context from the person uploading — "these files cover
 * three brands, consolidate at brand level", "the structure is in the PDF,
 * the spreadsheet is just payroll" — into an explicit, checkable plan for how
 * the files should be read.
 *
 * The division of labour is the one this whole app runs on: **the model is the
 * reader and the drafter, never the calculator.** It decides what a file *is*
 * and what a column *means*, because that is a judgement about English and
 * about how HR systems name things. It never touches a row. Everything that
 * follows — filtering, joining, stacking, grouping, costing — is done by the
 * deterministic code in bindFiles and buildGraph, working from the plan.
 *
 * So the model's whole output is this small object. That is what makes it
 * safe to hand a client's messy folder of exports to a model at all: the worst
 * a bad plan can do is bind the wrong file to the wrong role, which is
 * visible on the confirm screen and named there in the plan's own words. It
 * cannot invent a person, a cost or a reporting line, because it is never
 * asked for one.
 *
 * Everything the model returns is validated against the files that actually
 * arrived before any of it is used. A filename that doesn't exist, a column
 * that isn't in that file, a field that isn't canonical — each is dropped and
 * recorded as a warning shown to the user, rather than quietly ignored or
 * quietly applied.
 */

/** What a file is for. Anything not decided here falls back to the binder's own read. */
export type FileUse = "positions" | "attributes" | "structure" | "ignore";

export const FILE_USES: FileUse[] = ["positions", "attributes", "structure", "ignore"];

export interface FilePlan {
  filename: string;
  use: FileUse;
  /** The planner's reason, in its own words — shown to the user verbatim. */
  reason: string;
  /** Source column → canonical field. Overrides the synonym matcher for this file. */
  columns: Record<string, string>;
}

/**
 * The dimension the establishment should be consolidated on — brand, entity,
 * site, region. Each distinct value becomes one labelled grouping node, and
 * every otherwise-top-level role in that group hangs beneath it, so several
 * separate hierarchies read as one organisation instead of a pile of roots.
 */
export interface GroupPlan {
  /**
   * Every source column carrying the dimension, across every file. Two
   * exports from two systems almost never agree on what to call it — one
   * says "BRAND", the other "Source Brand" — and consolidating on one of
   * them alone would leave the other file's people ungrouped. The binder
   * coalesces all of them into a single column named after `label`.
   */
  columns: string[];
  /** Singular noun for the dimension: "Brand", "Entity", "Region". */
  label: string;
  /** Name for the single node all the groups sit under. */
  topLabel: string;
}

/** Rows to keep or drop before anything is bound. Matching is exact, case-insensitive. */
export interface RowFilter {
  column: string;
  include: string[];
  exclude: string[];
}

/**
 * Facts about the client's own data that no file states and only they know:
 * how many hours a full-time week is, which of their brand codes means which
 * brand. Normally these are collected as structured answers on the confirm
 * screen. The planner can also read them out of a sentence — "a full-time
 * week here is 38 hours and NB is Northbrook" — which is the point of letting
 * someone describe a correction in their own words rather than hunting for
 * the right box.
 *
 * Read, never invented: the planner is told to leave these null unless the
 * person actually said so, and everything it returns is checked against the
 * values that exist in the files before it is applied.
 */
export interface PlanAnswers {
  hoursPerWeek: number | null;
  valueMap: Record<string, Record<string, string>>;
}

export interface IngestPlan {
  files: FilePlan[];
  groupBy: GroupPlan | null;
  rowFilter: RowFilter | null;
  answers: PlanAnswers;
  /** The planner's summary of what it decided, in plain English. */
  notes: string;
  /** Everything the planner asked for that could not be honoured. */
  warnings: string[];
  source: "ai" | "unavailable" | "failed";
  model: string | null;
}

export interface PlanInput {
  filename: string;
  parsed: ParsedFile;
}

/**
 * What Atlas made of these same files last time, handed back to the planner
 * when the client is correcting it.
 *
 * Without this, a correction is answered by a reader that has never seen the
 * thing being corrected: "the chart isn't the structure" means nothing unless
 * you know Atlas used it as the structure. With it, the planner is looking at
 * its own previous conclusions, the questions it could not resolve, and the
 * sentence the client wrote in response — which is the whole of the context a
 * person would need to fix it themselves.
 */
export interface PriorRead {
  files: { filename: string; role: string; detail: string }[];
  notes: { kind: string; topic: string; statement: string }[];
  groupValues: { value: string; files: string[]; count: number }[];
}

const CANONICAL_KEYS = Object.keys(CANONICAL_FIELDS);

export const EMPTY_PLAN_ANSWERS: PlanAnswers = { hoursPerWeek: null, valueMap: {} };

/** True when the planner read something out of the text that changes a figure. */
export function planAnswersHaveEffect(answers: PlanAnswers | undefined): boolean {
  if (!answers) return false;
  return answers.hoursPerWeek !== null || Object.keys(answers.valueMap).length > 0;
}

/** Nobody works more hours a week than exist in one. */
const MAX_HOURS_PER_WEEK = 168;

/** Rows shown to the planner per file. Enough to recognise a column, not a copy of the data. */
const SAMPLE_ROWS = 4;
const MAX_VALUE_CHARS = 60;
const MAX_COLUMNS_SHOWN = 40;

const SYSTEM_PROMPT = `You are the ingest planner for Atlas, an organisation-design tool. You are given the files a client has uploaded and one instruction from the person uploading them. You decide how those files should be read.

You never transcribe, summarise or produce data. You return a plan and nothing else. Another system does all the joining, filtering and arithmetic from your plan.

Return ONLY a JSON object. No prose before or after it, no markdown code fences. Shape:

{
  "files": [
    { "filename": "<exactly as given>",
      "use": "positions" | "attributes" | "structure" | "ignore",
      "reason": "<one sentence, addressed to the client, saying why>",
      "columns": { "<source column exactly as given>": "<canonical field>" } }
  ],
  "groupBy": { "columns": ["<source column>", "…one per file that carries this dimension"], "label": "<singular noun>", "topLabel": "<name for the combined top node>" } | null,
  "rowFilter": { "column": "<source column>", "include": ["<value>"], "exclude": ["<value>"] } | null,
  "answers": { "hoursPerWeek": <number> | null,
               "valueMap": { "<dimension name, matching groupBy.label>": { "<value exactly as it appears in a file>": "<the value it should be read as, exactly as it appears in a file>" } } },
  "notes": "<2-4 sentences to the client: what you concluded and what you did about it>"
}

What each "use" means:
- "positions" — this file IS the establishment. Its rows become the positions. Use for staff lists, establishment extracts, headcount reports.
- "attributes" — this file describes facts ABOUT positions in another file (cost, FTE, status, department). Its rows are joined on, never added.
- "structure" — this file supplies reporting lines to be laid over the establishment. Use for org charts read from a PDF or an image, which usually carry who-reports-to-whom but no cost and only some of the people.
- "ignore" — leave this file out entirely. Only when the instruction says to, or the file plainly holds nothing about the organisation.

Canonical fields for "columns": ${CANONICAL_KEYS.join(", ")}. Use "ignore" as the value to stop a column being read as a field at all.

Rules, in order of importance:
1. Only override a column in "columns" when the automatic reading would be wrong or is clearly missing something. It already matches obvious names. Never map two source columns in one file to the same canonical field.
1b. Some columns are ones Atlas built from the file's own — "${COMPOSED_NAME}" from a split first/last name, "${COMPOSED_COST}" from a pay rate. Never map a different column to a field one of those already holds. A column of hourly or daily rates is not a cost, and mapping it to "cost" prices a person at one hour's pay; if such a column looks empty it is because the hours behind it are unknown, which is a question for the client, not a mapping to fix.
2. Follow the instruction. If it says the structure comes from a chart and the numbers from a spreadsheet, say so through "use", even when the spreadsheet also looks like a position list.
3. A chart or a diagram is "structure" whenever there is also a fuller staff list to lay it over. It is "positions" only when it is the only thing describing who exists.
4. Set "groupBy" only when the instruction asks for consolidation by some dimension AND a column carrying that dimension actually exists. List the exact column from EVERY file that carries it — two systems rarely name it the same way, and a file whose column you leave out will not be grouped at all. Do not list a column that merely correlates with the dimension.
5. Set "rowFilter" only when the instruction restricts which rows are in scope. Leave "include" or "exclude" empty when unused.
6. "answers" carries facts about the organisation that no file states. Set "hoursPerWeek" only when the person says how many hours a full-time week is — it turns hourly rates into annual costs, so a wrong number misprices everyone paid by the hour. Set "valueMap" only when they say that two values naming the same thing should be read as one ("NB is Northbrook"); both sides must be values that actually appear in the files. Leave either null or empty otherwise. Never infer them from the data.
7. Never invent a filename, a column name or a value. Copy them exactly as given to you. If the instruction asks for something the files cannot support, say so in "notes" and leave the corresponding part of the plan null.
8. When you are shown what Atlas concluded on a previous read, the person is correcting that reading. Address what they raise, and repeat the parts of the plan that were right — the plan you return replaces the previous one entirely, so anything you leave out is undone.`;

/**
 * Builds a plan from the user's context, or returns a plan-shaped record of
 * why there isn't one. Never throws: a planner that fails must leave ingest
 * working exactly as it does without context, because failing to plan is not
 * a reason to refuse a perfectly readable set of files.
 */
export async function planIngest(
  context: string,
  files: PlanInput[],
  /** What Atlas concluded last time, when this run is a correction of it. */
  prior: PriorRead | null = null
): Promise<IngestPlan | null> {
  const instruction = context.trim();
  if (!instruction || files.length === 0) return null;

  if (!hasAI()) {
    return {
      files: [],
      groupBy: null,
      rowFilter: null,
      answers: EMPTY_PLAN_ANSWERS,
      notes:
        "Your instructions were recorded but not applied. Reading them takes a model, and this " +
        "deployment has no AI key set, so the files were bound by their column names alone — " +
        "exactly as they would have been with the box left empty. Nothing was guessed at.",
      warnings: [],
      source: "unavailable",
      model: null,
    };
  }

  try {
    const answer = await ask({
      // A plan for a folder of ten files, each with forty columns, is a long
      // object — and a plan cut off mid-object is not a smaller plan, it is
      // no plan at all. This ceiling is set well above any real one so that
      // running out of room is a bug rather than a Tuesday.
      maxTokens: 16000,
      system: SYSTEM_PROMPT,
      prompt:
        `The person uploading these files says:\n\n"""\n${instruction}\n"""\n\n` +
        `Here is what actually arrived.\n\n${files.map(digest).join("\n\n")}\n\n` +
        (prior ? `${priorDigest(prior)}\n\n` : "") +
        `Return the plan as JSON.`,
    });

    const text = answer.text;

    // A truncated plan and a malformed one look identical by the time they
    // reach the parser, and they call for completely different responses —
    // so the one case that can be told apart is told apart here.
    if (answer.truncated) {
      return {
        files: [],
        groupBy: null,
        rowFilter: null,
        answers: EMPTY_PLAN_ANSWERS,
        notes:
          `Your instructions were recorded but not applied — reading them across ${files.length} file` +
          `${files.length === 1 ? "" : "s"} produced a plan too long to finish, so none of it was used ` +
          `rather than half of it. The files were bound by their column names alone. Uploading fewer ` +
          `files at once, or narrowing the instructions, will get them read.`,
        warnings: [],
        source: "failed",
        model: answer.model,
      };
    }

    return validatePlan(text, files, answer.model);
  } catch (err) {
    return {
      files: [],
      groupBy: null,
      rowFilter: null,
      answers: EMPTY_PLAN_ANSWERS,
      notes:
        `Your instructions were recorded but not applied — reading them failed (${(err as Error).message}). ` +
        `The files were bound by their column names alone, which is what happens with the box left empty.`,
      warnings: [],
      source: "failed",
      model: null,
    };
  }
}

/** One file as the planner sees it: what it is, its columns, a few real rows. */
function digest(file: PlanInput): string {
  const { headers, rows, conversion } = file.parsed;
  const shown = headers.slice(0, MAX_COLUMNS_SHOWN);

  const lines = [
    `FILE: ${file.filename}`,
    `  format: ${conversion.sourceFormat} — ${conversion.detail}`,
    `  rows: ${rows.length}`,
    `  columns (${headers.length}): ${shown.join(" | ")}${headers.length > shown.length ? " | …" : ""}`,
  ];

  for (const row of rows.slice(0, SAMPLE_ROWS)) {
    const cells = shown.map((h) => truncate(row[h] ?? ""));
    lines.push(`  row: ${cells.join(" | ")}`);
  }

  return lines.join("\n");
}

/**
 * The previous read, as the planner sees it: what it decided each file was
 * for, what it could not resolve, and the values it found in the dimension
 * being consolidated on. This is what turns "the chart isn't the structure"
 * from an unanswerable remark into a correction.
 */
function priorDigest(prior: PriorRead): string {
  const lines = ["ATLAS HAS ALREADY READ THESE FILES ONCE. What it concluded:"];

  for (const f of prior.files) {
    lines.push(`  ${f.filename} — used as: ${f.role}. ${truncate(f.detail, 220)}`);
  }

  const open = prior.notes.filter((n) => n.kind === "question");
  const made = prior.notes.filter((n) => n.kind === "assumption");

  if (open.length > 0) {
    lines.push("", "What it could NOT resolve, and is asking the client about:");
    for (const n of open) lines.push(`  [${n.topic}] ${truncate(n.statement, 240)}`);
  }
  if (made.length > 0) {
    lines.push("", "Readings it made and applied:");
    for (const n of made) lines.push(`  [${n.topic}] ${truncate(n.statement, 240)}`);
  }

  if (prior.groupValues.length > 0) {
    lines.push("", "Values found in the consolidation column, and which file each came from:");
    for (const v of prior.groupValues.slice(0, 40)) {
      lines.push(`  "${v.value}" — ${v.count} rows, in ${v.files.join(" + ")}`);
    }
  }

  lines.push(
    "",
    "The instruction above includes what the client has now said in response to that reading. Correct it."
  );
  return lines.join("\n");
}

function truncate(value: string, limit = MAX_VALUE_CHARS): string {
  const v = value.trim().replace(/\s+/g, " ");
  return v.length > limit ? `${v.slice(0, limit)}…` : v;
}

/**
 * Checks a planner response against the files that actually arrived, and
 * strips anything that doesn't hold up. Exported so the plan-application path
 * can be verified end to end without spending an API call — the model's
 * output is the only part of this feature that isn't deterministic, and this
 * is the boundary where it stops mattering.
 */
export function validatePlan(
  raw: string,
  files: PlanInput[],
  model: string | null
): IngestPlan {
  const warnings: string[] = [];

  const parsed = parseObject(raw);
  if (!parsed) {
    return {
      files: [],
      groupBy: null,
      rowFilter: null,
      answers: EMPTY_PLAN_ANSWERS,
      notes:
        "Your instructions were recorded but not applied — the plan came back in a shape Atlas could not read. " +
        "The files were bound by their column names alone.",
      warnings: [],
      source: "failed",
      model,
    };
  }

  // Filenames are matched loosely because a planner that echoes a path or
  // changes the case of an extension has still identified the right file.
  const byName = new Map(files.map((f) => [normaliseName(f.filename), f] as const));
  const headersOf = new Map(files.map((f) => [f.filename, f.parsed.headers] as const));

  const filePlans: FilePlan[] = [];
  const claimed = new Set<string>();

  for (const entry of asArray(parsed.files)) {
    if (!isRecord(entry)) continue;

    const requested = String(entry.filename ?? "");
    const file = byName.get(normaliseName(requested));
    if (!file) {
      warnings.push(`The plan referred to a file called "${requested}", which was not in this upload — ignored.`);
      continue;
    }
    if (claimed.has(file.filename)) {
      warnings.push(`"${file.filename}" was planned twice; the first decision was kept.`);
      continue;
    }

    const use = String(entry.use ?? "");
    if (!FILE_USES.includes(use as FileUse)) {
      warnings.push(`"${file.filename}" was given an unknown role ("${use}") — Atlas worked the role out for itself instead.`);
      continue;
    }

    claimed.add(file.filename);
    filePlans.push({
      filename: file.filename,
      use: use as FileUse,
      reason: String(entry.reason ?? "").trim(),
      columns: validateColumns(entry.columns, file, headersOf.get(file.filename) ?? [], warnings),
    });
  }

  const groupBy = validateGroupBy(parsed.groupBy, files, warnings);

  return {
    files: filePlans,
    groupBy,
    rowFilter: validateRowFilter(parsed.rowFilter, files, warnings),
    answers: validateAnswers(parsed.answers, files, groupBy, warnings),
    notes: String(parsed.notes ?? "").trim(),
    warnings,
    source: "ai",
    model,
  };
}

function validateColumns(
  raw: unknown,
  file: PlanInput,
  headers: string[],
  warnings: string[]
): Record<string, string> {
  if (!isRecord(raw)) return {};

  const out: Record<string, string> = {};
  const takenFields = new Set<string>();

  for (const [column, target] of Object.entries(raw)) {
    const actual = matchHeader(column, headers);
    if (!actual) {
      warnings.push(`The plan mapped a column called "${column}" in ${file.filename}, which that file does not have — ignored.`);
      continue;
    }

    const field = String(target ?? "").trim();
    if (field === "ignore") {
      out[actual] = "ignore";
      continue;
    }
    if (!CANONICAL_KEYS.includes(field)) {
      warnings.push(`"${actual}" in ${file.filename} was mapped to "${field}", which is not a field Atlas holds — ignored.`);
      continue;
    }
    // A field Atlas built a column for is not up for grabs. The composed
    // column exists precisely because the raw one does not hold that value:
    // "Rate" is what someone earns in an hour, and a plan that maps it to
    // cost prices a care worker's year at $36.
    const composed = field === "cost" ? COMPOSED_COST : field === "name" ? COMPOSED_NAME : null;
    if (composed && actual !== composed && headers.includes(composed)) {
      warnings.push(
        `The plan mapped "${actual}" in ${file.filename} to ${field}, but Atlas had already built a "${composed}" ` +
          `column from that file for exactly this — "${actual}" on its own is not ${field === "cost" ? "an annual cost" : "a full name"}. ` +
          `The built column was kept.`
      );
      continue;
    }

    // Two columns on one field would silently make one of them win. The
    // establishment is better off reading the second as an extra column.
    if (takenFields.has(field)) {
      warnings.push(`Both "${actual}" and another column in ${file.filename} were mapped to ${field}; only the first was used.`);
      continue;
    }

    takenFields.add(field);
    out[actual] = field;
  }

  return out;
}

function validateGroupBy(raw: unknown, files: PlanInput[], warnings: string[]): GroupPlan | null {
  if (!isRecord(raw)) return null;

  // A single "column" is accepted as well as a list, so a plan that names one
  // column for a one-file upload still works exactly as it reads.
  const requested = [
    ...asArray(raw.columns).map(String),
    ...(typeof raw.column === "string" ? [raw.column] : []),
  ]
    .map((c) => c.trim())
    .filter(Boolean);

  if (requested.length === 0) return null;

  const columns: string[] = [];
  const missing: string[] = [];
  for (const want of requested) {
    const actual = findColumnAcross(want, files);
    if (!actual) {
      missing.push(want);
      continue;
    }
    if (!columns.includes(actual)) columns.push(actual);
  }

  // One warning for the whole decision, not one per name: a plan that named
  // three columns and found none of them has made a single mistake, and
  // reporting it three times buries the five other things on the screen.
  if (missing.length > 0) {
    const named = missing.map((m) => `"${m}"`).join(", ");
    warnings.push(
      columns.length === 0
        ? `Atlas was asked to consolidate on ${named}, which ${missing.length === 1 ? "is" : "are"} not in any of these files, ` +
            `so the establishment was left ungrouped. Add that column to the export, or name one that is there.`
        : `Atlas was asked to consolidate on ${named} as well, which ${missing.length === 1 ? "is" : "are"} not in any of these files. ` +
            `Anyone whose only record of it was in ${missing.length === 1 ? "that column" : "those columns"} is ungrouped.`
    );
  }

  if (columns.length === 0) return null;

  return {
    columns,
    label: String(raw.label ?? "").trim() || columns[0],
    topLabel: String(raw.topLabel ?? "").trim() || "Consolidated organisation",
  };
}

/**
 * Checks the facts the planner says the client stated.
 *
 * These are the only part of a plan that moves money directly — an hours
 * figure reprices everyone paid by the hour — so both sides of every pairing
 * must be a value that actually appears in the files, and an hours figure has
 * to be a number of hours in a week. A pairing to something nobody wrote down
 * would merge a real part of the organisation into an invented one.
 */
function validateAnswers(
  raw: unknown,
  files: PlanInput[],
  groupBy: GroupPlan | null,
  warnings: string[]
): PlanAnswers {
  if (!isRecord(raw)) return EMPTY_PLAN_ANSWERS;

  const hours = Number(raw.hoursPerWeek);
  let hoursPerWeek: number | null = null;
  if (Number.isFinite(hours) && hours > 0) {
    if (hours <= MAX_HOURS_PER_WEEK) {
      hoursPerWeek = hours;
    } else {
      warnings.push(
        `Your instructions were read as saying a full-time week is ${hours} hours, which is more hours than a week holds — ignored.`
      );
    }
  }

  const valueMap: Record<string, Record<string, string>> = {};
  if (isRecord(raw.valueMap)) {
    // Every value the files actually contain, so a pairing can be checked
    // against reality rather than against the planner's memory of it.
    const known = new Set<string>();
    for (const file of files) {
      for (const row of file.parsed.rows) {
        for (const value of Object.values(row)) {
          const v = value.trim();
          if (v && v.length <= MAX_VALUE_CHARS) known.add(v.toLowerCase());
        }
      }
    }

    for (const [dimension, pairs] of Object.entries(raw.valueMap)) {
      if (!isRecord(pairs)) continue;
      // The binder looks the map up under the dimension's label, so a map
      // filed under anything else would never be applied.
      const column = groupBy && normaliseHeader(dimension) === normaliseHeader(groupBy.label)
        ? groupBy.label
        : (groupBy?.label ?? dimension);

      const clean: Record<string, string> = {};
      for (const [from, to] of Object.entries(pairs)) {
        const target = String(to ?? "").trim();
        const source = from.trim();
        if (!source || !target) continue;
        if (!known.has(source.toLowerCase()) || !known.has(target.toLowerCase())) {
          warnings.push(
            `Your instructions were read as pairing "${source}" with "${target}", but ${
              known.has(source.toLowerCase()) ? `"${target}"` : `"${source}"`
            } does not appear anywhere in these files — that pairing was dropped.`
          );
          continue;
        }
        clean[source] = target;
      }
      if (Object.keys(clean).length > 0) {
        valueMap[column] = { ...(valueMap[column] ?? {}), ...clean };
      }
    }
  }

  return { hoursPerWeek, valueMap };
}

function validateRowFilter(raw: unknown, files: PlanInput[], warnings: string[]): RowFilter | null {
  if (!isRecord(raw)) return null;

  const requested = String(raw.column ?? "").trim();
  if (!requested) return null;

  const actual = findColumnAcross(requested, files);
  if (!actual) {
    warnings.push(
      `Atlas was asked to filter rows on a column called "${requested}", which is not in any of these files, ` +
        `so every row was kept.`
    );
    return null;
  }

  const include = asArray(raw.include).map(String).map((v) => v.trim()).filter(Boolean);
  const exclude = asArray(raw.exclude).map(String).map((v) => v.trim()).filter(Boolean);

  if (include.length === 0 && exclude.length === 0) return null;

  return { column: actual, include, exclude };
}

/** Case- and punctuation-insensitive header lookup, returning the real header. */
export function matchHeader(requested: string, headers: string[]): string | null {
  const want = normaliseHeader(requested);
  return headers.find((h) => normaliseHeader(h) === want) ?? null;
}

function findColumnAcross(requested: string, files: PlanInput[]): string | null {
  for (const f of files) {
    const hit = matchHeader(requested, f.parsed.headers);
    if (hit) return hit;
  }
  return null;
}

function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");
}

function normaliseName(filename: string): string {
  return filename.trim().toLowerCase().split(/[\\/]/).pop() ?? "";
}

/**
 * Takes the JSON object out of whatever the model wrapped it in. Asking for
 * bare JSON gets bare JSON nearly always, but "here is the plan:" and a
 * ```json fence are both common enough to be worth surviving — and the
 * alternative, prefilling an opening brace to make a preamble impossible,
 * is not available: current models reject a conversation that ends on an
 * assistant message.
 */
function parseObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** True when the plan actually changes what ingest does. */
export function planHasEffect(plan: IngestPlan | null): boolean {
  return Boolean(
    plan &&
      plan.source === "ai" &&
      (plan.files.length > 0 ||
        plan.groupBy !== null ||
        plan.rowFilter !== null ||
        planAnswersHaveEffect(plan.answers))
  );
}
