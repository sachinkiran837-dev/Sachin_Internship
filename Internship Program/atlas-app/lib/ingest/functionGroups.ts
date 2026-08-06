import config from "@/config/function-groups.json";
import { ask, hasAI } from "@/lib/ai/client";
import { note, type IngestNote } from "./notes";
import { UNCLASSIFIED } from "@/lib/graph/types";

/**
 * Sixty department names rolled into the seven a board argues about.
 *
 * A real establishment does not carry "Finance". It carries "AP/AR", "Group
 * Treasury", "FP&A", "Payroll Services" and "Commercial Finance", and each of
 * them is too small to compare against anything. The comparison engine needs
 * eight positions in a unit before it will say a word about it, so on a real
 * client file most departments fall out of the comparison entirely and the
 * ones left describe whichever teams happened to be big — which is how
 * "which function is bloated" ends up answered about Payroll.
 *
 * So the raw department is kept, untouched, and a bucket is derived beside it.
 * Every comparison runs on the bucket; every scenario play still runs on the
 * real team, because merging a payroll team into treasury on the grounds that
 * both are "Finance" would be a redesign nobody asked for and the play would
 * price it as a saving.
 *
 * Placement is by rule first, model second, and neither by guessing: a
 * department no keyword claims and no model will place keeps its own name.
 * Sweeping the unrecognised into "Other" would produce a tidy seven buckets
 * with a quarter of the organisation in a bucket that means nothing.
 */

interface GroupRule {
  name: string;
  match: string[];
}

const GROUPS: GroupRule[] = config.groups;

/** The bucket names, in the order the config states them. */
export const FUNCTION_GROUPS: string[] = GROUPS.map((g) => g.name);

function normalise(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[&/,]+/g, " ")
      .replace(/[^a-z0-9+ ]+/g, " ")
      // "&" and "and" are the same word in a department name, and both
      // spellings turn up in one file. Without this, "Learning & Development"
      // fails to match "learning and development", falls through to the bare
      // word "development", and a training team is filed under Technology.
      .replace(/(^| )and( |$)/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Whether a department name contains a keyword.
 *
 * Short keywords have to appear as whole words. "hr" as a substring places
 * "Thrive Programme" in People and "it" places "Quality Audit" in Technology —
 * both of which happened before this rule existed.
 */
function contains(haystack: string, keyword: string): boolean {
  if (keyword.length <= 3) {
    return new RegExp(`(^| )${keyword.replace(/[+]/g, "\\+")}( |$)`).test(haystack);
  }
  return haystack.includes(keyword);
}

/** The bucket a department name falls in by rule, or null. Longest keyword wins. */
export function groupByRule(department: string): string | null {
  const value = normalise(department);
  if (!value) return null;

  let best: { name: string; length: number } | null = null;

  for (const group of GROUPS) {
    for (const keyword of group.match) {
      if (!contains(value, normalise(keyword))) continue;
      if (!best || keyword.length > best.length) best = { name: group.name, length: keyword.length };
    }
  }

  return best?.name ?? null;
}

export interface Grouping {
  /** Raw department name → the bucket it belongs to. */
  map: Map<string, string>;
  /**
   * Job title → bucket, consulted only where the department could not place
   * one. Empty on any file that states departments Atlas can read.
   */
  byTitle: Map<string, string>;
  /**
   * Departments that placed cleanly but were disbelieved, because the jobs
   * inside them mostly belong to a different function. A "Division" column
   * naming service lines lands here.
   */
  overruled: Set<string>;
  byRule: number;
  byModel: number;
  /** Departments that kept their own name because nothing would place them. */
  unplaced: string[];
  /** Positions whose function had to be read off their job title. */
  fromTitle: number;
  source: "rules" | "rules+ai";
}

const GROUPING_TOOL = {
  name: "place_departments",
  description:
    "Place each department name into one of the given business function groups, or leave it unplaced.",
  input_schema: {
    type: "object" as const,
    properties: {
      placements: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            department: { type: "string" as const, description: "The department name, copied exactly." },
            group: {
              type: "string" as const,
              description: `One of: ${FUNCTION_GROUPS.join(", ")}. Use "unplaced" when none of them is clearly right.`,
            },
          },
          required: ["department", "group"],
        },
      },
    },
    required: ["placements"],
  },
};

/** Beyond this many unrecognised names, the list is not a department column. */
const MAX_MODEL_NAMES = 120;

/**
 * Places every distinct department in this establishment.
 *
 * Called once per ingest with the unique names, never per position — a client
 * file has 1,000 rows and 60 departments, and the difference is one request
 * against a thousand.
 */
export async function groupDepartments(departments: string[]): Promise<Grouping> {
  const distinct = [...new Set(departments.map((d) => d.trim()).filter(Boolean))];
  const map = new Map<string, string>();
  const leftover: string[] = [];

  for (const department of distinct) {
    // A row with no department has nothing to place. It stays as it is, and
    // the coverage figures on the confirm screen already report it.
    if (department === UNCLASSIFIED) {
      map.set(department, UNCLASSIFIED);
      continue;
    }
    const byRule = groupByRule(department);
    if (byRule) map.set(department, byRule);
    else leftover.push(department);
  }

  const byRule = map.size - (map.has(UNCLASSIFIED) ? 1 : 0);

  let byModel = 0;
  const unplaced: string[] = [];

  if (leftover.length > 0 && leftover.length <= MAX_MODEL_NAMES && hasAI()) {
    byModel = await placeWithModel(leftover, map, "department");
  }

  for (const department of leftover) {
    if (!map.has(department)) {
      map.set(department, department);
      unplaced.push(department);
    }
  }

  return {
    map,
    byTitle: new Map(),
    overruled: new Set(),
    byRule,
    byModel,
    unplaced,
    fromTitle: 0,
    source: byModel > 0 ? "rules+ai" : "rules",
  };
}

/**
 * Below this many placeable job titles inside a department, the jobs are not
 * evidence about the department — they are a handful of people.
 */
const MIN_TITLE_EVIDENCE = 6;

/**
 * The share of those jobs that must agree with the department's own placement
 * for the department to be believed.
 */
const MIN_AGREEMENT = 0.5;

/**
 * The function every position sits in, given whatever the files said.
 *
 * Departments are the answer wherever a file states one Atlas can place. Two
 * things go wrong with that on real files, and both were seen on the first
 * client establishment this ran against.
 *
 * The first is a file with no department column at all. A payroll export
 * carries an employee ID, a job title, an FTE and a rate, and nothing about
 * which part of the organisation the person works in — leaving the whole
 * establishment as one function called "Unclassified" with nothing to compare.
 * There the job title is read instead: a Registered Nurse is in Operations and
 * a Payroll Officer is in Finance, and a file that names one names the other.
 *
 * The second is subtler and worse, because it looks like it worked. A column
 * headed "Division" holding "Head Office", "Platform" and "HCP" is a service
 * line or a location, not a function — and "Platform" places cleanly into
 * Technology, so twelve HR staff and sixteen finance staff inside it are filed
 * under Technology and the comparison is nonsense with no visible error.
 *
 * That case is caught by looking at the jobs inside each department. A real
 * Finance department is full of finance titles. A division is full of
 * everything — and where the jobs inside a department mostly disagree with the
 * department's own placement, the jobs win, because thirty people's job titles
 * are better evidence about what they do than one column heading.
 */
export async function groupPositions(
  positions: { department: string; title: string }[]
): Promise<Grouping> {
  const grouping = await groupDepartments(positions.map((p) => p.department));
  const real = new Set(FUNCTION_GROUPS);
  const titleOf = (p: { title: string }) => p.title.trim();

  // Every distinct title, placed by rule alone. Deterministic and free, and
  // needed here whether or not it ends up being used, because it is the
  // evidence the department column is judged against.
  const byTitle = new Map<string, string>();
  for (const title of new Set(positions.map(titleOf).filter(Boolean))) {
    const placed = groupByRule(title);
    if (placed) byTitle.set(title, placed);
  }

  // A department is only a function if the jobs inside it say so.
  const overruled = new Set<string>();
  for (const [department, group] of grouping.map) {
    if (!real.has(group)) continue;
    const evidence = positions
      .filter((p) => p.department === department)
      .map((p) => byTitle.get(titleOf(p)))
      .filter((g): g is string => Boolean(g));
    if (evidence.length < MIN_TITLE_EVIDENCE) continue;
    const agreeing = evidence.filter((g) => g === group).length;
    if (agreeing / evidence.length < MIN_AGREEMENT) overruled.add(department);
  }

  // Positions the department column cannot answer for: it named nothing
  // placeable, or it named a division the jobs inside it contradict.
  const orphaned = positions.filter(
    (p) => !real.has(grouping.map.get(p.department) ?? "") || overruled.has(p.department)
  );
  if (orphaned.length === 0) return grouping;

  const stillOut = [...new Set(orphaned.map(titleOf).filter(Boolean))].filter(
    (t) => !byTitle.has(t)
  );

  let byModel = grouping.byModel;
  if (stillOut.length > 0 && stillOut.length <= MAX_MODEL_NAMES && hasAI()) {
    byModel += await placeWithModel(stillOut, byTitle, "job title");
  }

  const fromTitle = orphaned.filter((p) => real.has(byTitle.get(titleOf(p)) ?? "")).length;

  return {
    ...grouping,
    byTitle,
    overruled,
    byModel,
    fromTitle,
    source: byModel > 0 ? "rules+ai" : "rules",
  };
}

/** The function this position belongs to, on the best evidence available. */
export function resolveGroup(
  grouping: Grouping,
  department: string,
  title: string
): string {
  const real = new Set(FUNCTION_GROUPS);
  const byDepartment = grouping.map.get(department);
  const trusted = byDepartment && real.has(byDepartment) && !grouping.overruled.has(department);
  if (trusted) return byDepartment;

  const byTitle = grouping.byTitle.get(title.trim());
  if (byTitle && real.has(byTitle)) return byTitle;

  // Nothing placed it. The department keeps its own name, exactly as it was
  // stated — including UNCLASSIFIED, which is a true statement about a file
  // that never said. A department already disbelieved keeps its raw name too:
  // having decided "Platform" is a place rather than a function, filing the
  // people in it whose titles said nothing under Technology anyway would put
  // back exactly the error the check exists to catch.
  if (grouping.overruled.has(department)) return department;
  return byDepartment ?? department;
}

/**
 * Asks the model to place the names no keyword claimed, writing only into
 * slots still empty. Returns how many it filled.
 */
async function placeWithModel(
  names: string[],
  into: Map<string, string>,
  kind: "department" | "job title"
): Promise<number> {
  let placed = 0;

  try {
    const answer = await ask({
      maxTokens: 2000,
      tool: GROUPING_TOOL,
      prompt:
        `These are ${kind}s from one organisation's establishment file. Place each into the ` +
        `business function group it belongs to.\n\n` +
        `Groups: ${FUNCTION_GROUPS.join(", ")}\n\n` +
        `${kind === "department" ? "Departments" : "Job titles"}:\n` +
        `${names.map((d) => `- ${d}`).join("\n")}\n\n` +
        `Rules: copy each name exactly as given. Judge by what the ` +
        `${kind === "department" ? "team does" : "person does"}, not by what the words look like. ` +
        `Where no group is clearly right, answer "unplaced" — a wrong placement is worse than none, ` +
        `because everything downstream compares these groups against each other.`,
    });

    const placements =
      ((answer.toolInput as { placements?: { department?: string; group?: string }[] } | null)
        ?.placements ?? []);
    const valid = new Set(FUNCTION_GROUPS);
    const wanted = new Map(names.map((d) => [d.toLowerCase(), d]));

    for (const placement of placements) {
      // Matched back against the names actually sent, so a model that invents
      // a name or renames one cannot introduce a group for nobody.
      const name = wanted.get((placement.department ?? "").trim().toLowerCase());
      if (!name || into.has(name)) continue;
      if (!placement.group || !valid.has(placement.group)) continue;
      into.set(name, placement.group);
      placed++;
    }
  } catch {
    // The establishment is fine; only the rollup is missing. Every unplaced
    // name keeps its own, which is exactly how Atlas behaved before this
    // existed.
  }

  return placed;
}

/**
 * The rollup, registered so it can be argued with.
 *
 * Every comparison on the findings screen is between these buckets, so a
 * client who disagrees with one of them disagrees with the finding built on
 * it — and they can only do that if they can see which of their departments
 * went where.
 */
export function groupingNote(grouping: Grouping, total: number): IngestNote | null {
  const placed = grouping.byRule + grouping.byModel;
  if (placed === 0) return null;

  const used = [
    ...new Set([...grouping.map.values(), ...grouping.byTitle.values()]),
  ].filter((g) => FUNCTION_GROUPS.includes(g));

  return note("function-groups", "assumption", {
    topic: "Departments rolled up",
    statement:
      `Your ${total} department${total === 1 ? "" : "s"} were rolled into ${used.length} function ` +
      `group${used.length === 1 ? "" : "s"} — ${used.join(", ")} — and every comparison on the findings ` +
      `screen is between those groups. The department each person is actually in is unchanged, and ` +
      `every scenario play still works on the real team rather than the group.`,
    evidence:
      `${grouping.byRule} placed by name` +
      (grouping.byModel > 0 ? `, ${grouping.byModel} by reading what the team does` : "") +
      (grouping.unplaced.length > 0
        ? `, and ${grouping.unplaced.length} left as stated because nothing would place ${grouping.unplaced.length === 1 ? "it" : "them"}: ` +
          `${grouping.unplaced.slice(0, 6).join(", ")}${grouping.unplaced.length > 6 ? ", …" : ""}`
        : "") +
      `.`,
    effect:
      `Sixty departments cannot be compared against each other — most are below the size where a ratio ` +
      `means anything, so the comparison would describe whichever teams happened to be large. ` +
      `Grouped, "which function is bloated" is answered about ${used[0] ?? "a function"} rather than about one team inside it.`,
  });
}

/**
 * States, separately, where a function was read off a job title.
 *
 * This is a weaker reading than a department column and it has a specific
 * failure the client is the only one who can catch: a Finance Manager sitting
 * inside an operating division is filed under Finance by their title, which
 * describes their job rather than where they sit. It is worth doing anyway —
 * the alternative is one function called "Unclassified" and nothing to
 * compare — but it is not worth hiding inside the rollup note.
 */
export function titleFallbackNote(
  grouping: Grouping,
  total: number
): IngestNote | null {
  if (grouping.fromTitle === 0) return null;

  const used = [...new Set(grouping.byTitle.values())].filter((g) =>
    FUNCTION_GROUPS.includes(g)
  );
  const overruled = [...grouping.overruled];

  return note("function-from-title", "assumption", {
    topic: "Function read from job title",
    statement:
      `${grouping.fromTitle.toLocaleString()} of ${total.toLocaleString()} positions had no department ` +
      `Atlas could use, so their function was read from their job title instead.`,
    evidence:
      `${grouping.byTitle.size} distinct job title${grouping.byTitle.size === 1 ? "" : "s"} were ` +
      `placed into ${used.length} function${used.length === 1 ? "" : "s"} — ${used.join(", ")}.` +
      (overruled.length > 0
        ? ` ${overruled.length === 1 ? "One department was" : `${overruled.length} departments were`} ` +
          `set aside as ${overruled.length === 1 ? "a division rather than a function" : "divisions rather than functions"} — ` +
          `${overruled.join(", ")} — because most of the jobs inside ${overruled.length === 1 ? "it" : "them"} ` +
          `belong to a different function. A department called "Platform" holding finance and HR staff is a ` +
          `place, not a function.`
        : ""),
    effect:
      `Every comparison on the findings screen counts these people. A title says what someone does, ` +
      `not which part of the organisation they sit in — so a Finance Manager inside an operating ` +
      `division counts against Finance here. The department each person is in is unchanged and every ` +
      `scenario play still works on it.`,
  });
}

/**
 * States the one case where the rollup above didn't run at all: the client
 * asked, in their own words, for the department to also be the function.
 *
 * Recorded with the same weight as a rollup would be, because it changes the
 * same thing a rollup changes — what every comparison on the findings screen
 * is between — and a client reading a function called "Payroll Services" with
 * eleven people in it should be able to see that this is why, not wonder
 * whether Atlas failed to group it.
 */
export function functionAsStatedNote(distinctDepartments: number): IngestNote {
  return note("function-as-stated", "assumption", {
    topic: "Function left as stated",
    statement:
      `Your instructions said to treat department as function, so the ${distinctDepartments} department` +
      `${distinctDepartments === 1 ? "" : "s"} in this establishment were not rolled up into broader ` +
      `groups — every comparison on the findings screen runs on them exactly as your files named them.`,
    evidence: "Read from your instructions, not from the data.",
    effect:
      `A department below the size where a comparison means anything is still compared on its own — ` +
      `nothing this small is merged into a broader group to make the comparison safer. If a finding ` +
      `about a tiny department looks unreliable, that is why.`,
  });
}
