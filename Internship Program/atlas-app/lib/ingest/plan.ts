import { AI_MODEL, getAnthropicClient, hasAI } from "@/lib/ai/client";
import { CANONICAL_FIELDS } from "@/lib/graph/types";
import type { ParsedFile } from "./parseFile";

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
  column: string;
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

export interface IngestPlan {
  files: FilePlan[];
  groupBy: GroupPlan | null;
  rowFilter: RowFilter | null;
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

const CANONICAL_KEYS = Object.keys(CANONICAL_FIELDS);

/** Rows shown to the planner per file. Enough to recognise a column, not a copy of the data. */
const SAMPLE_ROWS = 4;
const MAX_VALUE_CHARS = 60;
const MAX_COLUMNS_SHOWN = 40;

const SYSTEM_PROMPT = `You are the ingest planner for Atlas, an organisation-design tool. You are given the files a client has uploaded and one instruction from the person uploading them. You decide how those files should be read.

You never transcribe, summarise or produce data. You return a plan and nothing else. Another system does all the joining, filtering and arithmetic from your plan.

Return ONLY a JSON object. No prose, no markdown fences. Shape:

{
  "files": [
    { "filename": "<exactly as given>",
      "use": "positions" | "attributes" | "structure" | "ignore",
      "reason": "<one sentence, addressed to the client, saying why>",
      "columns": { "<source column exactly as given>": "<canonical field>" } }
  ],
  "groupBy": { "column": "<source column>", "label": "<singular noun>", "topLabel": "<name for the combined top node>" } | null,
  "rowFilter": { "column": "<source column>", "include": ["<value>"], "exclude": ["<value>"] } | null,
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
2. Follow the instruction. If it says the structure comes from a chart and the numbers from a spreadsheet, say so through "use", even when the spreadsheet also looks like a position list.
3. A chart or a diagram is "structure" whenever there is also a fuller staff list to lay it over. It is "positions" only when it is the only thing describing who exists.
4. Set "groupBy" only when the instruction asks for consolidation by some dimension AND a column carrying that dimension actually exists. Name the exact column.
5. Set "rowFilter" only when the instruction restricts which rows are in scope. Leave "include" or "exclude" empty when unused.
6. Never invent a filename, a column name or a value. Copy them exactly as given to you. If the instruction asks for something the files cannot support, say so in "notes" and leave the corresponding part of the plan null.`;

/**
 * Builds a plan from the user's context, or returns a plan-shaped record of
 * why there isn't one. Never throws: a planner that fails must leave ingest
 * working exactly as it does without context, because failing to plan is not
 * a reason to refuse a perfectly readable set of files.
 */
export async function planIngest(
  context: string,
  files: PlanInput[]
): Promise<IngestPlan | null> {
  const instruction = context.trim();
  if (!instruction || files.length === 0) return null;

  if (!hasAI()) {
    return {
      files: [],
      groupBy: null,
      rowFilter: null,
      notes:
        "Your instructions were recorded but not applied. Reading them takes the Anthropic API, " +
        "and this deployment has no ANTHROPIC_API_KEY set, so the files were bound by their column " +
        "names alone — exactly as they would have been with the box left empty. Nothing was guessed at.",
      warnings: [],
      source: "unavailable",
      model: null,
    };
  }

  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content:
            `The person uploading these files says:\n\n"""\n${instruction}\n"""\n\n` +
            `Here is what actually arrived.\n\n${files.map(digest).join("\n\n")}\n\n` +
            `Return the plan as JSON.`,
        },
        // Prefilling the brace removes the whole class of "here is the plan
        // you asked for" preambles rather than stripping them afterwards.
        { role: "assistant", content: "{" },
      ],
    });

    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();

    return validatePlan(`{${text}`, files, response.model);
  } catch (err) {
    return {
      files: [],
      groupBy: null,
      rowFilter: null,
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

function truncate(value: string): string {
  const v = value.trim().replace(/\s+/g, " ");
  return v.length > MAX_VALUE_CHARS ? `${v.slice(0, MAX_VALUE_CHARS)}…` : v;
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

  return {
    files: filePlans,
    groupBy: validateGroupBy(parsed.groupBy, files, warnings),
    rowFilter: validateRowFilter(parsed.rowFilter, files, warnings),
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

  const requested = String(raw.column ?? "").trim();
  if (!requested) return null;

  const actual = findColumnAcross(requested, files);
  if (!actual) {
    warnings.push(
      `Atlas was asked to consolidate on a column called "${requested}", which is not in any of these files, ` +
        `so the establishment was left ungrouped. Add that column to the export, or name one that is there.`
    );
    return null;
  }

  return {
    column: actual,
    label: String(raw.label ?? "").trim() || actual,
    topLabel: String(raw.topLabel ?? "").trim() || "Consolidated organisation",
  };
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

function parseObject(raw: string): Record<string, unknown> | null {
  // The prefill guarantees a leading brace; truncation damages the tail.
  const end = raw.lastIndexOf("}");
  const candidate = end === -1 ? raw : raw.slice(0, end + 1);
  try {
    const parsed: unknown = JSON.parse(candidate);
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
      (plan.files.length > 0 || plan.groupBy !== null || plan.rowFilter !== null)
  );
}
