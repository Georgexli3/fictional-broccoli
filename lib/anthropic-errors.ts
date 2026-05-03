/**
 * V1.7.1: Anthropic SDK error → HTTP response classifier.
 *
 * The SDK retries 429s and 5xx automatically (`maxRetries: 2` by default,
 * exponential backoff), so when we see one here it's persistent — the user
 * needs a clear "wait and retry" hint, not a stack trace.
 *
 * Used by /api/parse and /api/edit. Keep the messages user-friendly: the
 * client surfaces them verbatim in the proposed-change panel.
 */

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export interface ClassifiedError {
  status: number;
  body: { ok: false; error: string };
}

export function classifyAnthropicError(error: unknown): ClassifiedError {
  if (error instanceof Anthropic.RateLimitError) {
    const retryAfter = error.headers?.["retry-after"];
    const hint = retryAfter
      ? `Try again in ${retryAfter}s.`
      : "Wait a few seconds and try again.";
    return {
      status: 429,
      body: {
        ok: false,
        error: `Rate limited by Anthropic. The proxy may have hit its spend cap, or there's transient load. ${hint}`,
      },
    };
  }
  if (error instanceof Anthropic.APIError) {
    if (error.status >= 500) {
      return {
        status: 502,
        body: {
          ok: false,
          error: "Anthropic returned a server error. Try again in a moment.",
        },
      };
    }
    if (error.status === 401 || error.status === 403) {
      return {
        status: 500,
        body: {
          ok: false,
          error:
            "Anthropic auth failed. The proxy token may be missing or invalid — check ANTHROPIC_API_KEY.",
        },
      };
    }
    return {
      status: error.status,
      body: { ok: false, error: `Anthropic API error: ${error.message}` },
    };
  }
  return {
    status: 502,
    body: {
      ok: false,
      error: `Anthropic call failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    },
  };
}

export function classifyAnthropicErrorAsResponse(error: unknown): Response {
  const { status, body } = classifyAnthropicError(error);
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function classifyAnthropicErrorAsNextResponse<
  T extends { ok: false; error: string },
>(error: unknown): NextResponse<T> {
  const { status, body } = classifyAnthropicError(error);
  return NextResponse.json(body as T, { status });
}
