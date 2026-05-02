import { NextResponse } from "next/server";

import { anthropic, DEFAULT_MODEL } from "@/lib/anthropic";
import { env, hasBlob, hasKv } from "@/lib/env";

/**
 * Health endpoint for post-deploy verification.
 *
 * Returns the status of every dependency the app needs:
 *   - env validation (already enforced at boot via lib/env.ts)
 *   - Anthropic proxy reachability (1-token completion)
 *   - Vercel Blob token presence (not actively pinged; presence is enough)
 *   - Vercel KV reachability (lightweight ping if configured)
 *
 * `pnpm verify:deploy <url>` POSTs to this and fails CI if any check is red.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CheckStatus = "ok" | "skipped" | "error";

interface HealthResponse {
  ok: boolean;
  env: {
    appEnv: string;
    vercelEnv?: string;
  };
  anthropic: {
    status: CheckStatus;
    latencyMs?: number;
    error?: string;
  };
  blob: {
    status: CheckStatus;
  };
  kv: {
    status: CheckStatus;
    error?: string;
  };
}

async function pingAnthropic(): Promise<HealthResponse["anthropic"]> {
  const started = Date.now();
  try {
    // 1-token completion is the cheapest possible reachability check.
    await anthropic.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });
    return { status: "ok", latencyMs: Date.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "error", error: message };
  }
}

async function pingKv(): Promise<HealthResponse["kv"]> {
  if (!hasKv) return { status: "skipped" };
  try {
    // Lazy import so missing env doesn't crash boot.
    const { kv } = await import("@vercel/kv");
    await kv.set("__health_ping", Date.now(), { ex: 60 });
    await kv.del("__health_ping");
    return { status: "ok" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "error", error: message };
  }
}

export async function GET() {
  const [anthropicResult, kvResult] = await Promise.all([
    pingAnthropic(),
    pingKv(),
  ]);

  const response: HealthResponse = {
    ok:
      anthropicResult.status === "ok" &&
      (kvResult.status === "ok" || kvResult.status === "skipped"),
    env: {
      appEnv: env.NEXT_PUBLIC_APP_ENV,
      vercelEnv: env.VERCEL_ENV,
    },
    anthropic: anthropicResult,
    blob: { status: hasBlob ? "ok" : "skipped" },
    kv: kvResult,
  };

  return NextResponse.json(response, {
    status: response.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
