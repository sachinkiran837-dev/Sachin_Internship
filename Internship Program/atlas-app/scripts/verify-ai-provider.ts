/**
 * The provider layer: which vendor Atlas is talking to, whether it can
 * actually do the three things Atlas asks a model for, and — since Gemini
 * joined as a fallback vendor — whether a broken primary genuinely falls
 * back to it rather than the request just failing.
 *
 * Swapping vendors is the kind of change that looks finished long before it
 * is. Text generation works on the first try — it is a prompt in and a string
 * out on any API — so a smoke test that only writes a paragraph reports
 * success while the two things Atlas actually depends on are quietly broken:
 * forced tool use, which is how every structured read gets its object back,
 * and truncation reporting, which is the difference between "this plan is
 * wrong" and "this plan stops halfway".
 *
 * So this exercises all three, against whichever key is configured. The
 * selection rules are checked with no network at all; the round trips are
 * skipped with a stated reason when there is no key rather than failing, so
 * this stays runnable on a machine that has none.
 *
 * Run with `npx tsx --env-file=.env.local scripts/verify-ai-provider.ts`.
 */
import { ask, aiModel, aiProvider, hasAI, providerLabel } from "../lib/ai/client";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

/** Runs a block with a temporary environment, then puts it back exactly. */
function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    previous[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const NONE = {
  OPENAI_API_KEY: undefined,
  ANTHROPIC_API_KEY: undefined,
  GEMINI_API_KEY: undefined,
  AI_PROVIDER: undefined,
};

async function main() {
  /* --- 1. selection, with no network involved -------------------------- */

  withEnv(NONE, () => {
    assert(aiProvider() === null, "no keys must mean no provider");
    assert(!hasAI(), "no keys must mean hasAI() is false");
    assert(providerLabel() === "no AI provider", `unset must read plainly: ${providerLabel()}`);
  });

  withEnv({ ...NONE, OPENAI_API_KEY: "sk-test" }, () => {
    assert(aiProvider() === "openai", "an OpenAI key alone selects OpenAI");
    assert(aiModel() === "gpt-4o", `default OpenAI model: got ${aiModel()}`);
  });

  withEnv({ ...NONE, ANTHROPIC_API_KEY: "sk-test" }, () => {
    assert(aiProvider() === "anthropic", "an Anthropic key alone selects Anthropic");
    assert(aiModel() === "claude-sonnet-5", `default Anthropic model: got ${aiModel()}`);
  });

  withEnv({ ...NONE, GEMINI_API_KEY: "g-test" }, () => {
    assert(aiProvider() === "google", "a Gemini key alone selects Gemini — it must work standalone, not only as a fallback");
    assert(aiModel() === "gemini-flash-latest", `default Gemini model: got ${aiModel()}`);
    assert(providerLabel() === "Gemini", `providerLabel must read plainly: ${providerLabel()}`);
  });

  // The case this exists for: a key added alongside an old one. Switching
  // must not require deleting the old key first, because that is an outage
  // in between.
  withEnv({ ...NONE, OPENAI_API_KEY: "sk-a", ANTHROPIC_API_KEY: "sk-b" }, () => {
    assert(aiProvider() === "openai", "with both keys and no preference, OpenAI wins");
  });

  // Gemini sits last in the default order — in practice it's added as the
  // fallback vendor alongside an existing primary, not as anyone's chosen
  // first pick, so it must never silently outrank a key that was already
  // there.
  withEnv({ ...NONE, ANTHROPIC_API_KEY: "sk-b", GEMINI_API_KEY: "g-test" }, () => {
    assert(aiProvider() === "anthropic", "Gemini must not outrank an existing Anthropic key by default");
  });

  withEnv({ OPENAI_API_KEY: "sk-a", ANTHROPIC_API_KEY: "sk-b", AI_PROVIDER: "anthropic" }, () => {
    assert(aiProvider() === "anthropic", "AI_PROVIDER must override the default order");
  });

  withEnv({ ...NONE, GEMINI_API_KEY: "g-test", AI_PROVIDER: "gemini" }, () => {
    assert(aiProvider() === "google", `AI_PROVIDER must accept "gemini" as well as "google": got ${aiProvider()}`);
  });

  // A preference for a provider whose key is missing is not a fallback to
  // the other one. It is a misconfiguration, and pretending otherwise would
  // send requests somewhere the operator did not choose.
  withEnv({ ...NONE, ANTHROPIC_API_KEY: "sk-b", AI_PROVIDER: "openai" }, () => {
    assert(aiProvider() === null, "AI_PROVIDER naming a provider with no key must select nothing");
  });

  withEnv({ ...NONE, OPENAI_API_KEY: "sk-a", OPENAI_MODEL: "gpt-4.1" }, () => {
    assert(aiModel() === "gpt-4.1", `the model override must win: got ${aiModel()}`);
  });

  console.log("1. Selection rules hold: order, override, missing-key preference, model overrides, Gemini included.");

  /* --- 2. the three things Atlas actually asks for --------------------- */

  if (!hasAI()) {
    console.log(
      "2. No key configured, so the live round trips were skipped. Set OPENAI_API_KEY, " +
        "ANTHROPIC_API_KEY or GEMINI_API_KEY and run this again before trusting a deployment."
    );
    console.log("\nPROVIDER SELECTION CHECKS PASSED (round trips skipped)");
    return;
  }

  console.log(`2. Live checks against ${providerLabel()}, model "${aiModel()}".`);

  // (a) plain text.
  const text = await ask({
    prompt: "Reply with exactly the word: ready",
    maxTokens: 20,
  });
  assert(text.text.toLowerCase().includes("ready"), `plain text failed: "${text.text}"`);
  assert(text.toolInput === null, "no tool was forced, so none should come back");
  console.log(`   a. Text          → "${text.text}" (model ${text.model})`);

  // (b) forced tool use. The one every structured read in Atlas depends on:
  // the plan, the hypothesis layer, role classification, brand reconciliation.
  const tool = await ask({
    maxTokens: 500,
    tool: {
      name: "record_units",
      description: "Record the business units named in the text.",
      input_schema: {
        type: "object",
        properties: {
          units: {
            type: "array",
            description: "One entry per unit named.",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "The unit's name, copied exactly." },
                revenue: { type: "number", description: "Revenue in whole dollars." },
              },
              required: ["name", "revenue"],
            },
          },
        },
        required: ["units"],
      },
    },
    prompt: 'Record the units in this sentence: "AgeUp did 40 million and Homewell did 26 million."',
  });

  assert(tool.toolInput !== null, "forced tool use returned nothing — structured reads cannot work");
  const { units } = tool.toolInput as { units?: { name: string; revenue: number }[] };
  assert(Array.isArray(units) && units.length === 2, `expected 2 units, got ${JSON.stringify(units)}`);
  assert(
    units.some((u) => /ageup/i.test(u.name) && u.revenue === 40_000_000),
    `the tool must return usable values, not abbreviations: ${JSON.stringify(units)}`
  );
  console.log(`   b. Forced tool   → ${units.map((u) => `${u.name}=${u.revenue.toLocaleString()}`).join(", ")}`);

  // (c) truncation, reported rather than left to the parser. A structured
  // answer cut off mid-object is indistinguishable from a malformed one by
  // the time it reaches JSON.parse, and the two call for opposite responses.
  const cut = await ask({
    prompt: "Write a 500-word description of an organisational restructure.",
    maxTokens: 16,
  });
  assert(cut.truncated, "a 16-token ceiling on a long answer must report as truncated");
  console.log(`   c. Truncation    → reported (finish at ceiling), not left to the parser`);

  console.log(`\nALL PROVIDER CHECKS PASSED against ${providerLabel()}`);

  /* --- 3. the vendor-level fallback -------------------------------------- */

  if (!process.env.GEMINI_API_KEY) {
    console.log(
      "\n3. No GEMINI_API_KEY configured, so the fallback round trip was skipped. Set it and run " +
        "this again to prove a broken primary actually reaches Gemini rather than just failing."
    );
    return;
  }

  console.log("\n3. A broken primary key falls back to Gemini rather than failing outright.");
  // withEnv is synchronous — its `finally` restores the environment the
  // instant `fn()` returns, which for an async callback is before the
  // awaited network call inside it has actually run. Saved and restored by
  // hand here instead, around the whole awaited round trip.
  const brokenVar = aiProvider() === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const realKey = process.env[brokenVar];
  process.env[brokenVar] = `${brokenVar === "ANTHROPIC_API_KEY" ? "sk-ant" : "sk"}-deliberately-invalid`;
  try {
    const fallback = await ask({ prompt: "Reply with exactly the word: ready", maxTokens: 20 });
    assert(fallback.text.toLowerCase().includes("ready"), `expected the Gemini fallback to answer, got: "${fallback.text}"`);
    assert(fallback.model.toLowerCase().includes("gemini"), `expected a Gemini model to have answered, got: ${fallback.model}`);
    console.log(`   Primary key broken deliberately → answered via ${fallback.model} instead of failing`);
  } finally {
    process.env[brokenVar] = realKey;
  }

  console.log("\nFALLBACK CHECK PASSED — a failing primary vendor reaches Gemini, not an error");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
