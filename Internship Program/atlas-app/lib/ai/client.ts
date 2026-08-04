import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import modelTiers from "@/config/model-tiers.json";

/**
 * The one place a model is spoken to, and the only place that knows which
 * vendor is behind it.
 *
 * Atlas asks a model for exactly three things — read this prose and give me
 * back a structured object, write me a paragraph from figures I have already
 * computed, and tell me what is drawn in this picture. None of those are
 * vendor-specific, but the APIs are: one takes `max_tokens` and the other
 * `max_completion_tokens`, one reports truncation as `stop_reason` and the
 * other as `finish_reason`, one takes an image as a typed source block and
 * the other as a data URL. Left in the call sites, those differences would
 * be copied into six files and one of them would drift.
 *
 * So the call sites ask for what they want and never learn who answered.
 * `ask()` is the whole surface: a prompt, an optional tool to force, an
 * optional image, and a ceiling. What comes back says whether it was cut off,
 * because a truncated plan is not a smaller plan — it is no plan at all, and
 * every caller has to be able to tell that apart from a bad one.
 *
 * Visible-fallback pattern (house convention, not invented here): every
 * AI-shaped behaviour in this app has a deterministic fallback path, and the
 * UI must say plainly which path it took. Nothing is silently degraded.
 */

export type AiProvider = "anthropic" | "openai";

/**
 * Which vendor this deployment is talking to, or null when none is
 * configured.
 *
 * `AI_PROVIDER` decides when it is set. Otherwise the first key present
 * wins, OpenAI first — a deployment that has just had an OpenAI key added
 * alongside an old Anthropic one is a deployment that is switching, and
 * making them delete the old key first would mean an outage in between.
 */
export function aiProvider(): AiProvider | null {
  const forced = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (forced === "openai") return process.env.OPENAI_API_KEY ? "openai" : null;
  if (forced === "anthropic") return process.env.ANTHROPIC_API_KEY ? "anthropic" : null;

  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

export function hasAI(): boolean {
  return aiProvider() !== null;
}

/** Named for the person reading a message about it, not for a config file. */
export function providerLabel(): string {
  switch (aiProvider()) {
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    default:
      return "no AI provider";
  }
}

/**
 * The model in use.
 *
 * Both defaults are deliberately the workhorse of their family rather than
 * the newest thing: this has to run on whatever account the key came from,
 * and a model id the account cannot reach fails at the first request with an
 * error that looks nothing like "wrong model". Override per provider when
 * you want a pinned snapshot or something better.
 */
export function aiModel(): string {
  return aiProvider() === "openai"
    ? (process.env.OPENAI_MODEL ?? "gpt-4o")
    : (process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5");
}

/**
 * How costly a wrong read is, for a touchpoint that routes free-form user
 * context to a model: `low` closed classification, `medium` bounded
 * structured extraction, `high` open interpretation or synthesis. Resolves
 * against `config/model-tiers.json`; a call site that never sets a tier
 * keeps using {@link aiModel}'s single default, unaffected by this file.
 *
 * The full inventory of where Atlas ever asks a model to read something —
 * kept here as the one place this list is written down, since three other
 * files' doc comments point back to it rather than repeat it:
 *   - Ingest (A): `parseVisual.ts` (chart/image), `readSource.ts` (free text),
 *     `plan.ts` (column-binding plan), `reconcile.ts` (duplicate rows),
 *     `functionGroups.ts` (department classification), `hypothesis/read.ts`
 *     (business context) — all pre-existing.
 *   - Ask Atlas (I3): `lib/ask/interpret.ts`'s `askModelForTool` — reached
 *     only once keyword matching finds nothing; picks among the same 7 fixed
 *     tools, never answers the query itself.
 *   - Scenario moves (H): `lib/scenario/mutate.ts`'s `askModelForMove` —
 *     reached only once regex matching finds nothing; reads one of the same
 *     5 fixed move kinds, never decides whether the move is safe
 *     (`guardrails.ts` still gates it, same as a typed move).
 *   - Findings narrative (I): `lib/findings/generate.ts` — pre-existing.
 *
 * Deliberately absent: G1's causal stories/questions/falsifiers, I1's
 * board-pack judgment sentence, I2's pushback — all narrative *generation*,
 * kept as deterministic templates so a sentence can never say something the
 * evidence block doesn't support. Every touchpoint above is a *read*: text
 * in, a choice among a small fixed set of already-existing engine calls out.
 * That distinction, not a headcount, is the actual rule.
 */
export type AiTier = "low" | "medium" | "high";

function modelForTier(tier: AiTier): string {
  const entry = (modelTiers as Record<AiTier, { anthropic: string; openai: string }>)[tier];
  return aiProvider() === "openai" ? entry.openai : entry.anthropic;
}

/** Kept as a value for the call sites that only report which model ran. */
export const AI_MODEL = aiModel();

/**
 * A tool the model is forced to call, used purely to get a structured object
 * back rather than to let it do anything. Same JSON Schema either way — the
 * two vendors disagree about where it hangs in the request, not what it says.
 */
export interface AiTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AiMedia {
  kind: "image" | "pdf";
  /** e.g. "image/png". Ignored for PDFs. */
  mediaType: string;
  base64: string;
}

export interface AiRequest {
  prompt: string;
  system?: string;
  maxTokens: number;
  timeoutMs?: number;
  /** When set, the model must answer by calling it. */
  tool?: AiTool;
  media?: AiMedia;
  /** Routes to a model sized for the task. Omitted keeps {@link aiModel}'s single default. */
  tier?: AiTier;
}

export interface AiResult {
  /** The text answer. Empty when a tool was forced. */
  text: string;
  /** The tool's arguments, or null when the model returned none. */
  toolInput: unknown | null;
  /**
   * The answer hit the output ceiling and stops mid-thought.
   *
   * Reported rather than left to the parser because a cut-off structured
   * answer and a malformed one are indistinguishable by the time they reach
   * JSON.parse, and they call for opposite responses: one means raise the
   * ceiling, the other means the model got it wrong.
   */
  truncated: boolean;
  model: string;
}

let anthropic: Anthropic | null = null;
let openai: OpenAI | null = null;

export async function ask(request: AiRequest): Promise<AiResult> {
  const provider = aiProvider();
  if (!provider) {
    throw new Error("No AI provider is configured — check hasAI() before calling this.");
  }
  return provider === "openai" ? askOpenAI(request) : askAnthropic(request);
}

/* ------------------------------------------------------------------ */
/* Anthropic                                                           */
/* ------------------------------------------------------------------ */

async function askAnthropic(request: AiRequest): Promise<AiResult> {
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const content: Anthropic.ContentBlockParam[] = [];
  if (request.media) {
    content.push(
      request.media.kind === "pdf"
        ? {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: request.media.base64 },
          }
        : {
            type: "image",
            source: {
              type: "base64",
              media_type: request.media.mediaType as "image/png",
              data: request.media.base64,
            },
          }
    );
  }
  content.push({ type: "text", text: request.prompt });

  const response = await anthropic.messages.create(
    {
      model: request.tier ? modelForTier(request.tier) : aiModel(),
      max_tokens: request.maxTokens,
      ...(request.system ? { system: request.system } : {}),
      ...(request.tool
        ? {
            tools: [
              {
                name: request.tool.name,
                description: request.tool.description,
                input_schema: request.tool
                  .input_schema as Anthropic.Tool["input_schema"],
              },
            ],
            tool_choice: { type: "tool" as const, name: request.tool.name },
          }
        : {}),
      messages: [{ role: "user", content }],
    },
    request.timeoutMs ? { timeout: request.timeoutMs } : undefined
  );

  const toolUse = response.content.find((b) => b.type === "tool_use");

  return {
    text: response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim(),
    toolInput: toolUse && toolUse.type === "tool_use" ? toolUse.input : null,
    truncated: response.stop_reason === "max_tokens",
    model: response.model,
  };
}

/* ------------------------------------------------------------------ */
/* OpenAI                                                              */
/* ------------------------------------------------------------------ */

async function askOpenAI(request: AiRequest): Promise<AiResult> {
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
  if (request.media) {
    parts.push(
      request.media.kind === "pdf"
        ? {
            type: "file",
            file: {
              filename: "source.pdf",
              file_data: `data:application/pdf;base64,${request.media.base64}`,
            },
          }
        : {
            type: "image_url",
            image_url: { url: `data:${request.media.mediaType};base64,${request.media.base64}` },
          }
    );
  }
  parts.push({ type: "text", text: request.prompt });

  const response = await openai.chat.completions.create(
    {
      model: request.tier ? modelForTier(request.tier) : aiModel(),
      // Not `max_tokens`: that parameter is deprecated and rejected outright
      // by the newer models, which is a failure that looks like a bad key
      // rather than like a bad parameter.
      max_completion_tokens: request.maxTokens,
      messages: [
        ...(request.system
          ? [{ role: "system" as const, content: request.system }]
          : []),
        { role: "user" as const, content: parts },
      ],
      ...(request.tool
        ? {
            tools: [
              {
                type: "function" as const,
                function: {
                  name: request.tool.name,
                  description: request.tool.description,
                  parameters: request.tool.input_schema,
                },
              },
            ],
            // Forced, exactly as on the other side. Structured output is the
            // only reason a tool exists here — there is nothing to call.
            tool_choice: {
              type: "function" as const,
              function: { name: request.tool.name },
            },
          }
        : {}),
    },
    request.timeoutMs ? { timeout: request.timeoutMs } : undefined
  );

  const choice = response.choices[0];
  const call = choice?.message?.tool_calls?.find(
    (c) => c.type === "function" && c.function.name === request.tool?.name
  );

  let toolInput: unknown | null = null;
  if (call && call.type === "function") {
    try {
      toolInput = JSON.parse(call.function.arguments);
    } catch {
      // Arguments that don't parse are almost always arguments that were cut
      // off. Left as null so the caller takes its fallback, with `truncated`
      // below telling it which kind of failure this was.
      toolInput = null;
    }
  }

  return {
    text: (choice?.message?.content ?? "").trim(),
    toolInput,
    truncated: choice?.finish_reason === "length",
    model: response.model,
  };
}
