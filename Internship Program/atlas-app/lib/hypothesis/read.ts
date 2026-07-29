import { ask, hasAI, providerLabel } from "@/lib/ai/client";
import {
  EMPTY_BUSINESS,
  type Belief,
  type BusinessContext,
  type Constraint,
  type RevenueLine,
  type Target,
} from "./context";

/**
 * Reads the hypothesis layer: turns what a client wrote about their business
 * into facts Atlas can compute against.
 *
 * The model is doing the only job it is ever trusted with here — reading. It
 * takes "AgeUp did about forty million last year and we think ops is carrying
 * too many team leaders" and returns a revenue line and a belief. It does not
 * decide whether the belief is true, does not divide revenue by headcount, and
 * does not get to name a unit that isn't in the establishment: every unit it
 * returns is checked back against the real list, and anything that doesn't
 * match is reported as unmatched rather than quietly attached to the nearest
 * thing.
 *
 * A figure that comes back wrong is worse than one that doesn't come back at
 * all, because it will be divided by a headcount and put in front of a board.
 * So the client's own sentence travels with every fact, and the screen shows
 * it next to the number.
 */

const CONTEXT_TOOL = {
  name: "record_business_context",
  description:
    "Record the business facts stated in the client's own words. Extract only what they actually said.",
  input_schema: {
    type: "object" as const,
    properties: {
      sector: {
        type: "string",
        description:
          "What this organisation does, in the client's own words. Empty string if they didn't say.",
      },
      revenue: {
        type: "array",
        description:
          "Revenue figures the client stated. One entry per figure. Do not derive, total or split anything.",
        items: {
          type: "object",
          properties: {
            unit: {
              type: "string",
              description:
                "The unit this revenue belongs to, copied EXACTLY from the list of units given. Empty string when the figure is for the whole organisation.",
            },
            amount: {
              type: "number",
              description:
                "The figure in whole currency units. '40m' is 40000000, '$1.2bn' is 1200000000. Never abbreviated.",
            },
            period: {
              type: "string",
              description: "The period it covers, in their words — 'FY26', 'last year'. Empty if unstated.",
            },
            statedAs: {
              type: "string",
              description: "The client's own sentence or clause this came from, quoted verbatim.",
            },
          },
          required: ["unit", "amount", "period", "statedAs"],
        },
      },
      targets: {
        type: "array",
        description: "Things the client said they are trying to reach.",
        items: {
          type: "object",
          properties: {
            measure: {
              type: "string",
              enum: ["cost", "headcount", "layers", "span", "other"],
              description: "What is being aimed at.",
            },
            amount: {
              type: "number",
              description:
                "The number, in whole units — dollars for cost, people for headcount, a count for layers. Use 0 when the target has no number.",
            },
            horizon: {
              type: "string",
              description: "When by, in their words. Empty if unstated.",
            },
            statedAs: { type: "string", description: "Their own words, quoted verbatim." },
          },
          required: ["measure", "amount", "horizon", "statedAs"],
        },
      },
      beliefs: {
        type: "array",
        description:
          "Things the client says they already think are true about the organisation — suspicions, hunches, diagnoses. These will be tested against the data, so capture them even when vague.",
        items: {
          type: "object",
          properties: {
            unit: {
              type: "string",
              description:
                "The unit the belief is about, copied EXACTLY from the list given. Empty string if it is about the whole organisation.",
            },
            about: {
              type: "string",
              enum: ["management", "cost", "productivity", "workforce-mix", "structure", "other"],
              description:
                "management = too many/few managers or layers. cost = spend or pay levels. productivity = output per person. workforce-mix = agency, contractors, vacancies, permanent balance. structure = who reports to whom, duplication, where work sits.",
            },
            statedAs: { type: "string", description: "Their own words, quoted verbatim." },
          },
          required: ["unit", "about", "statedAs"],
        },
      },
      constraints: {
        type: "array",
        description: "Anything the client said is off limits, committed, or must not change.",
        items: {
          type: "object",
          properties: {
            unit: {
              type: "string",
              description: "The unit it applies to, copied EXACTLY from the list given. Empty for organisation-wide.",
            },
            statedAs: { type: "string", description: "Their own words, quoted verbatim." },
          },
          required: ["unit", "statedAs"],
        },
      },
      unmatched: {
        type: "array",
        description:
          "Anything the client said that carries a business fact you could NOT attach to a unit in the list, or could not fit the fields above. Say what it was and why, in one line each.",
        items: { type: "string" },
      },
    },
    required: ["sector", "revenue", "targets", "beliefs", "constraints", "unmatched"],
  },
};

const fold = (v: string) => v.trim().toLowerCase();

/**
 * Matches a unit name the model returned against the establishment's real
 * units. Case and spacing are forgiven; anything else is not — a near-miss
 * silently snapped to the wrong unit would attach a revenue figure to the
 * wrong part of the business.
 */
function matchUnit(raw: string, units: string[]): string | null {
  const value = raw.trim();
  if (value === "") return null;
  return units.find((u) => fold(u) === fold(value)) ?? null;
}

export async function readBusinessContext(
  raw: string,
  /** Every unit name the establishment actually has, across both cuts. */
  units: string[]
): Promise<BusinessContext> {
  const text = raw.trim();
  if (text.length === 0) return EMPTY_BUSINESS;

  // Without a key the prose is still kept and still shown — it just isn't
  // turned into figures. A context window that silently discards what someone
  // typed is worse than one that admits it only stored it.
  if (!hasAI()) {
    return {
      ...EMPTY_BUSINESS,
      raw: text,
      source: "none",
      unmatched: [
        "Atlas kept what you wrote but could not read figures out of it — this deployment has no AI key set, so there is nothing to do the reading. Everything below is computed from your files alone.",
      ],
    };
  }

  try {
    const answer = await ask({
      maxTokens: 4000,
      timeoutMs: 30_000,
      tool: CONTEXT_TOOL,
      prompt:
        `A client has described their organisation ahead of a restructure review. Record the business ` +
        `facts they stated.\n\n` +
        `Rules:\n` +
        `1. Extract only what they said. Never infer a revenue figure, a target or a belief they did not state.\n` +
        `2. Never calculate. If they give revenue and you know the headcount, do not compute revenue per head — that is done elsewhere from the establishment data.\n` +
        `3. Every "unit" must be copied exactly from the list below, or left as an empty string. If they name a part of the business that is not on the list, put it in "unmatched" instead of guessing which one they meant.\n` +
        `4. A statement can be both a belief and a target. Record it in both.\n` +
        `5. Quote their own words in "statedAs" — do not paraphrase. The client will see these quoted back.\n\n` +
        `Units in this establishment:\n${units.map((u) => `- ${u}`).join("\n") || "- (none identified)"}\n\n` +
        `What the client wrote:\n"""\n${text}\n"""`,
    });

    if (answer.truncated) {
      return {
        ...EMPTY_BUSINESS,
        raw: text,
        source: "none",
        unmatched: [
          "Atlas's reading of what you wrote ran past its limit and was cut off part-way, so none of it was used rather than half of it. Shorten it, or split it across two saves.",
        ],
      };
    }

    if (answer.toolInput === null) {
      return { ...EMPTY_BUSINESS, raw: text, source: "none" };
    }

    return validate(answer.toolInput as RawContext, text, units);
  } catch (err) {
    return {
      ...EMPTY_BUSINESS,
      raw: text,
      source: "none",
      unmatched: [`Atlas could not read figures out of what you wrote — ${providerLabel()} returned: ${(err as Error).message}`],
    };
  }
}

interface RawContext {
  sector?: string;
  revenue?: { unit?: string; amount?: number; period?: string; statedAs?: string }[];
  targets?: { measure?: string; amount?: number; horizon?: string; statedAs?: string }[];
  beliefs?: { unit?: string; about?: string; statedAs?: string }[];
  constraints?: { unit?: string; statedAs?: string }[];
  unmatched?: string[];
}

const MEASURES: Target["measure"][] = ["cost", "headcount", "layers", "span", "other"];
const ABOUT: Belief["about"][] = [
  "management",
  "cost",
  "productivity",
  "workforce-mix",
  "structure",
  "other",
];

/**
 * Everything the model returned, checked before it is allowed to become a
 * figure on a screen. A unit that doesn't exist, an amount that isn't a
 * positive number, a category outside the list — each one is dropped and
 * reported, never repaired.
 */
function validate(input: RawContext, raw: string, units: string[]): BusinessContext {
  const unmatched: string[] = [...(input.unmatched ?? [])].filter(
    (u) => typeof u === "string" && u.trim().length > 0
  );

  const revenue: RevenueLine[] = [];
  for (const line of input.revenue ?? []) {
    const amount = Number(line.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      unmatched.push(
        `A revenue figure was recorded without a usable amount, so it was left out: "${line.statedAs ?? ""}".`
      );
      continue;
    }
    const named = (line.unit ?? "").trim();
    const unit = named === "" ? null : matchUnit(named, units);
    if (named !== "" && unit === null) {
      unmatched.push(
        `Revenue of ${amount.toLocaleString()} was given for "${named}", which is not a ${
          units.length > 0 ? "unit in this establishment" : "unit Atlas could find"
        }. Left out rather than attached to something that only resembles it.`
      );
      continue;
    }
    revenue.push({
      unit,
      amount,
      period: (line.period ?? "").trim(),
      statedAs: (line.statedAs ?? "").trim(),
    });
  }

  const targets: Target[] = [];
  for (const t of input.targets ?? []) {
    const measure = MEASURES.includes(t.measure as Target["measure"])
      ? (t.measure as Target["measure"])
      : "other";
    const amount = Number(t.amount);
    targets.push({
      measure,
      amount: Number.isFinite(amount) && amount > 0 ? amount : null,
      horizon: (t.horizon ?? "").trim() || null,
      statedAs: (t.statedAs ?? "").trim(),
    });
  }

  const beliefs: Belief[] = [];
  for (const b of input.beliefs ?? []) {
    const statedAs = (b.statedAs ?? "").trim();
    if (statedAs === "") continue;
    const named = (b.unit ?? "").trim();
    const unit = named === "" ? null : matchUnit(named, units);
    if (named !== "" && unit === null) {
      unmatched.push(
        `You said something about "${named}", which Atlas could not find in the establishment: "${statedAs}". It is recorded but not tested against any unit.`
      );
    }
    beliefs.push({
      unit,
      about: ABOUT.includes(b.about as Belief["about"]) ? (b.about as Belief["about"]) : "other",
      statedAs,
    });
  }

  const constraints: Constraint[] = [];
  for (const c of input.constraints ?? []) {
    const statedAs = (c.statedAs ?? "").trim();
    if (statedAs === "") continue;
    const named = (c.unit ?? "").trim();
    constraints.push({ unit: named === "" ? null : matchUnit(named, units), statedAs });
  }

  return {
    raw,
    sector: (input.sector ?? "").trim() || null,
    revenue,
    targets: targets.filter((t) => t.statedAs !== ""),
    beliefs,
    constraints,
    unmatched,
    source: "ai",
  };
}
