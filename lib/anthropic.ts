import Anthropic from "@anthropic-ai/sdk";

import { env } from "./env";

/**
 * Anthropic client pointed at the take-home hiring proxy.
 *
 * The proxy is a drop-in replacement for the official API — same SDK, same
 * request shapes, same streaming. We only swap the `baseURL` and reuse the
 * auth token. Default URL lives in `lib/env.ts`.
 */
export const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
  baseURL: env.ANTHROPIC_BASE_URL,
});

/**
 * Default model for parse + edit calls. Sonnet 4.6 is the best balance of
 * accuracy and cost for this workload — fast enough for streaming, smart
 * enough for structured-output tool use, supports native PDF input + prompt
 * caching at ~10× input price.
 */
export const DEFAULT_MODEL = "claude-sonnet-4-6";
