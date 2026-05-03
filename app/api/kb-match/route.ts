/**
 * V1.7.2: proactive KB match endpoint.
 *
 * Client posts the active doc's blocks once (after parse / hydrate); the
 * server scores each editable block against the KB topic bags and returns
 * a sparse map of `{ blockId: KbMatch }`. The client renders subtle 📎
 * hints on matched blocks.
 *
 * Why server-side: `loadKb()` reads from disk via `fs.readFileSync`, which
 * needs the Node runtime. Also keeps the KB topic bags and stopword list
 * server-only so we don't bloat the client bundle.
 *
 * Why a separate endpoint instead of merging into /api/parse: parse is
 * cached in KV; the matcher should run per session (KB updates would
 * otherwise be invisible until a parse-cache bust). Cheap enough to be
 * its own call (~10 ms on a 100-block doc, no LLM).
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { loadKb } from "@/lib/kb";
import { matchBlocksToKb, type KbMatch } from "@/lib/kb-match";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestBodySchema = z.object({
  excludeHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  blocks: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        kind: z.string(),
      }),
    )
    .max(2000),
});

export async function POST(request: Request) {
  let body: z.infer<typeof requestBodySchema>;
  try {
    body = requestBodySchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof z.ZodError
            ? `Invalid request: ${error.issues.map((i) => i.message).join("; ")}`
            : "Invalid JSON",
      },
      { status: 400 },
    );
  }

  const kb = loadKb(body.excludeHash);
  if (!kb.loaded) {
    return NextResponse.json({ ok: true, matches: {} });
  }

  const matches = matchBlocksToKb(body.blocks, kb, body.excludeHash);
  const out: Record<string, KbMatch> = {};
  matches.forEach((value, key) => {
    out[key] = value;
  });

  return NextResponse.json({ ok: true, matches: out });
}
