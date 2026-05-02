import { NextResponse } from "next/server";

/**
 * Telemetry collector — V1 no-op.
 *
 * Scaffolded so call sites in `lib/track.ts` have a stable destination.
 * Wiring this to Posthog is a 30-min V1.5 task: replace the no-op with a
 * `posthog.capture(...)` call.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (process.env.NEXT_PUBLIC_APP_ENV !== "production") {
      // Helpful in dev to see what we'd be sending.
      // eslint-disable-next-line no-console
      console.log("[/api/events]", body);
    }
  } catch {
    // ignore — telemetry must never break the app
  }
  return new NextResponse(null, { status: 204 });
}
