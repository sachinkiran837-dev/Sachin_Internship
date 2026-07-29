import { ask, hasAI } from "@/lib/ai/client";
import type { BoundDataset } from "./bindFiles";
import { note, type IngestNote, type NoteOption } from "./notes";
import type { IngestAnswers } from "./answers";
import type { Position } from "@/lib/graph/types";

/**
 * Checks the files against each other once they are bound, and says where
 * they disagree.
 *
 * A single export is self-consistent by construction. Several are not: two
 * systems in the same company will call one brand "365 Care" and "365C", and
 * an org map that consolidates on that column ends up drawing two brands
 * where there is one. Nothing in the data says they are the same — only the
 * client knows that — so Atlas will not merge them on a resemblance.
 *
 * What it does instead is notice, propose, and ask. The proposal is drafted
 * by the model, which is the right tool for "does "365C" mean "365 Care"?"
 * and the wrong tool for anything downstream of it: the pairing it returns
 * is shown to the client as an editable suggestion and applied only once
 * they have confirmed it. Until then the groups stay as the files wrote them.
 */

/** Below this share of values in common, two files are speaking different vocabularies. */
const SHARED_VOCABULARY = 0.5;

export async function reconcileGroups(
  bound: BoundDataset,
  answers: IngestAnswers
): Promise<IngestNote | null> {
  if (!bound.groupBy || bound.groupValues.length === 0) return null;

  const { label } = bound.groupBy;

  const files = [...new Set(bound.groupValues.flatMap((v) => v.files))];
  if (files.length < 2) return null;

  const valuesIn = (filename: string) =>
    bound.groupValues.filter((v) => v.files.includes(filename)).map((v) => v.value);

  // The two files carrying the most values are the pair worth reconciling;
  // a third file that agrees with either is already covered by the mapping.
  const ranked = files
    .map((filename) => ({ filename, values: valuesIn(filename) }))
    .sort((a, b) => b.values.length - a.values.length);

  const [primary, secondary] = ranked;
  if (!secondary || secondary.values.length === 0) return null;

  const shared = secondary.values.filter((v) => primary.values.includes(v));
  const orphans = secondary.values.filter((v) => !primary.values.includes(v));
  if (orphans.length === 0) return null;
  if (shared.length / secondary.values.length > SHARED_VOCABULARY) return null;

  // Anything the client has already reconciled is not a question any more.
  const settled = answers.valueMap[label] ?? {};
  const unresolved = orphans.filter((v) => !settled[v]);
  if (unresolved.length === 0) return null;

  const proposal = await proposeMapping(unresolved, primary.values, label);

  const counts = new Map(bound.groupValues.map((v) => [v.value, v.count] as const));
  const affected = unresolved.reduce((n, v) => n + (counts.get(v) ?? 0), 0);

  return note("group-vocabulary", "question", {
    topic: `${label} names`,
    statement:
      `Your files use two different vocabularies for ${label.toLowerCase()}, and Atlas has left them as ` +
      `separate groups rather than merge names that merely look alike.`,
    evidence:
      `"${secondary.filename}" uses ${describe(secondary.values)}. ` +
      `"${primary.filename}" uses ${describe(primary.values)}. ` +
      `${unresolved.length} value${unresolved.length === 1 ? "" : "s"} covering ` +
      `${affected.toLocaleString()} people appear in one and not the other.` +
      (proposal.source === "ai" ? "" : ` The pairing below compares the words themselves.`),
    effect:
      `Until these are paired the map shows up to ${primary.values.length + unresolved.length} ` +
      `${label.toLowerCase()} groups instead of ${primary.values.length}, and no ${label.toLowerCase()} ` +
      `total is complete. Confirm or correct each pairing and Atlas will consolidate on the next run.`,
    answerKind: "mapping",
    options: proposal.options,
  });
}

function describe(values: string[]): string {
  const shown = values.slice(0, 5).map((v) => `"${v}"`).join(", ");
  return values.length > 5 ? `${shown} and ${values.length - 5} more` : shown;
}

const MAPPING_TOOL = {
  name: "pair_values",
  description: "Pair values from two vocabularies that name the same thing.",
  input_schema: {
    type: "object" as const,
    properties: {
      pairs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            from: { type: "string", description: "A value from the first list, copied exactly." },
            to: {
              type: "string",
              description:
                "The value from the second list that names the same thing, copied exactly. Empty string if none does.",
            },
          },
          required: ["from", "to"],
        },
      },
    },
    required: ["pairs"],
  },
};

/**
 * Drafts the pairing. The model is a reader here and nothing else: it is
 * handed two lists of bare values and returns pairs of them, never a count,
 * a cost or a decision that reaches the map unreviewed. Every value it
 * returns is checked back against the lists it was given, so a pairing to
 * something it invented is dropped rather than offered.
 */
async function proposeMapping(
  orphans: string[],
  candidates: string[],
  label: string
): Promise<{ options: NoteOption[]; source: "ai" | "similarity" }> {
  const fallback = () => ({
    options: orphans.map((from) => ({
      from,
      to: mostSimilar(from, candidates) ?? "",
      seenIn: label,
    })),
    source: "similarity" as const,
  });

  if (!hasAI()) return fallback();

  try {
    const answer = await ask({
      maxTokens: 2000,
      tool: MAPPING_TOOL,
      prompt:
        `Two systems in one company record the same "${label}" dimension with different value sets. ` +
        `Pair each value in the first list with the value in the second list that names the same thing. ` +
        `They are commonly an abbreviation and its full form, or the same name punctuated differently. ` +
        `Return an empty "to" for any value with no counterpart — a wrong pairing is worse than none, ` +
        `because it merges two real parts of the organisation into one.\n\n` +
        `First list:\n${orphans.map((v) => `- ${v}`).join("\n")}\n\n` +
        `Second list:\n${candidates.map((v) => `- ${v}`).join("\n")}`,
    });

    if (answer.toolInput === null) return fallback();

    const { pairs } = answer.toolInput as { pairs?: { from: string; to: string }[] };
    const byFrom = new Map((pairs ?? []).map((p) => [p.from, p.to] as const));

    return {
      options: orphans.map((from) => {
        const to = byFrom.get(from) ?? "";
        // A pairing to a value that isn't on the list is a pairing to
        // nothing. Offering it would put an invented group on the map.
        return { from, to: candidates.includes(to) ? to : "", seenIn: label };
      }),
      source: "ai",
    };
  } catch {
    return fallback();
  }
}

/** Longest shared prefix of the two, ignoring case and punctuation. */
function mostSimilar(value: string, candidates: string[]): string | null {
  const clean = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = clean(value);

  let best: string | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const other = clean(candidate);
    let i = 0;
    while (i < target.length && i < other.length && target[i] === other[i]) i++;
    // Two characters of agreement is a coincidence, not a match.
    if (i > bestScore && i >= 3) {
      bestScore = i;
      best = candidate;
    }
  }

  return best;
}

/**
 * The pairings that were actually applied, stated back.
 *
 * Merging "365C" into "365 Care" removes a group from the map and moves
 * everyone in it. Whether the client typed the pairing into a box or wrote it
 * in a sentence, the result is the same and has to be as visible as the
 * question it replaced — otherwise answering a question makes it vanish, and
 * a reader coming to the screen later sees six brands with no record that
 * there were ten.
 */
export function appliedMapping(
  bound: BoundDataset,
  answers: IngestAnswers,
  /** True when the pairing was read out of the client's prose rather than typed. */
  fromInstructions: boolean
): IngestNote | null {
  if (!bound.groupBy) return null;

  const { label } = bound.groupBy;
  const pairs = Object.entries(answers.valueMap[label] ?? {});
  if (pairs.length === 0) return null;

  return note("group-vocabulary-applied", "assumption", {
    topic: `${label} names`,
    statement:
      `${pairs.length} ${label.toLowerCase()} value${pairs.length === 1 ? "" : "s"} from one file ` +
      `${pairs.length === 1 ? "was" : "were"} read as naming the same thing as a value in another, and merged into one group.`,
    evidence:
      pairs.map(([from, to]) => `"${from}" was read as "${to}"`).join("; ") +
      (fromInstructions
        ? `. Atlas took that from what you wrote in your instructions rather than from anything in the files.`
        : `. You confirmed these pairings on this screen.`),
    effect:
      `Everyone recorded under the left-hand value now sits under the right-hand group, and the ` +
      `${label.toLowerCase()} totals cover both. Say so below if any pair should be kept apart.`,
    answeredWith: fromInstructions ? "from your instructions" : "confirmed by you",
  });
}

/**
 * How much of the establishment carries a cost at all.
 *
 * Raised as a note rather than left to the coverage bars because a map whose
 * cost is 40% complete looks exactly like a map whose cost is complete until
 * someone reads the small print, and every saving quoted off it is wrong by
 * the missing share.
 */
export function costCoverage(positions: Position[]): IngestNote | null {
  const real = positions.filter((p) => !p.synthetic);
  const uncosted = real.filter((p) => p.cost <= 0);
  if (uncosted.length === 0 || real.length === 0) return null;

  const share = (uncosted.length / real.length) * 100;
  const zeroFte = uncosted.filter((p) => p.fte <= 0).length;

  return note("cost-coverage", "question", {
    topic: "What the establishment costs",
    statement: `${uncosted.length.toLocaleString()} of ${real.length.toLocaleString()} positions carry no cost, and Atlas has left them at $0 rather than estimate one.`,
    evidence:
      `That is ${share.toFixed(0)}% of the establishment` +
      (zeroFte > 0
        ? `, of which ${zeroFte.toLocaleString()} also carry 0 FTE — your files record them as people with no contracted hours.`
        : `. No file that reached them stated a pay figure Atlas could read.`),
    effect:
      `Every cost, saving and cost-per-layer figure on the following screens is of the ` +
      `${(real.length - uncosted.length).toLocaleString()} positions that are priced. Treat them as a floor, not a total.`,
  });
}
