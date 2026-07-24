import Anthropic from "@anthropic-ai/sdk";

/**
 * Visible-fallback pattern (house convention, not invented here): every
 * AI-shaped behaviour in this app has a deterministic fallback path, and the
 * UI must say plainly which path it took. Nothing is silently degraded.
 */
export function hasAI(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!hasAI()) {
    throw new Error("ANTHROPIC_API_KEY is not set — check hasAI() before calling this.");
  }
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

// Model id family per Anthropic's current naming (see claude-api skill /
// docs.anthropic.com for the live list). Override via ANTHROPIC_MODEL if a
// pinned dated snapshot is preferred for reproducibility.
export const AI_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
