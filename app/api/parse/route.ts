import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";

import { anthropic, DEFAULT_MODEL } from "@/lib/anthropic";
import { classifyAnthropicErrorAsNextResponse } from "@/lib/anthropic-errors";
import { buildPdfDocumentSource } from "@/lib/anthropic-pdf";
import { isEditableKind, type DocumentModel } from "@/lib/doc-model";
import { parsedDocumentSchema } from "@/lib/doc-model-zod";
import { getCachedParse, setCachedParse } from "@/lib/kv";
import {
  emitDocumentStructureTool,
  PARSE_SYSTEM_PROMPT,
  PARSE_USER_PROMPT,
} from "@/lib/parse-prompt";
import { probePdf } from "@/lib/pdf-probe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Bumped for Pro/Enterprise; on Hobby this is silently capped at 300s, but
// the streamed response below extends the wall time as long as keepalive
// bytes flow — sidestepping the per-request ceiling.
export const maxDuration = 800;

const requestBodySchema = z.object({
  blobUrl: z.string().url(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  reparse: z.boolean().optional().default(false),
});

interface ParseSuccess {
  ok: true;
  cached: boolean;
  doc: DocumentModel;
}

interface ParseFailure {
  ok: false;
  error: string;
}

type ParseResponse = ParseSuccess | ParseFailure;

/**
 * Parse a PDF into a structured DocumentModel.
 *
 * Order of operations:
 *   1. KV cache lookup by SHA-256 hash. Hit → return immediately.
 *   2. Send PDF to Claude Sonnet 4.6 with the parse-tool schema. Claude
 *      emits one structured tool call; we parse, validate (Zod), enrich with
 *      stable nanoid block IDs + reading-order, and store an `original`
 *      revision for each block.
 *   3. Persist to KV (best-effort; KV failures don't block the response).
 *
 * V1 is non-streamed — the route waits for the full tool call before
 * responding. M8 upgrades this to streamed partial-block delivery via SSE.
 */
export async function POST(request: Request): Promise<Response> {
  let body: z.infer<typeof requestBodySchema>;
  try {
    const json = await request.json();
    body = requestBodySchema.parse(json);
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

  // 1. Cache lookup.
  if (!body.reparse) {
    const cached = await getCachedParse(body.hash);
    if (cached) {
      return NextResponse.json({ ok: true, cached: true, doc: cached });
    }
  }

  // 2. Pre-flight probe — catches encrypted/password-protected and
  // image-only PDFs before we burn an Anthropic call. ~200–500 ms on the
  // happy path; saves ~60–120 s + ~$0.20 on bad PDFs and gives the user
  // an actionable error message instead of a generic Anthropic failure.
  const probe = await probePdf(body.blobUrl);
  if (!probe.ok) {
    return NextResponse.json(
      { ok: false, error: probe.reason },
      { status: 400 },
    );
  }

  // 3. Send to Claude.
  let pdfSource: Awaited<ReturnType<typeof buildPdfDocumentSource>>;
  try {
    pdfSource = await buildPdfDocumentSource({
      blobUrl: body.blobUrl,
      hash: body.hash,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: `Failed to prepare PDF for Claude: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 502 },
    );
  }

  // Helper: do one Anthropic parse attempt and return validated doc model
  // (or null + diagnostic shape if the attempt's output can't be coerced).
  type AttemptResult =
    | { ok: true; data: z.infer<typeof parsedDocumentSchema> }
    | { ok: false; reason: string; shape: Record<string, unknown> };

  async function attemptParse(extraInstruction?: string): Promise<AttemptResult> {
    const userText = extraInstruction
      ? `${PARSE_USER_PROMPT}\n\n${extraInstruction}`
      : PARSE_USER_PROMPT;
    // Streaming sidesteps the proxy's per-request response-time cap.
    // `messages.create()` was timing out at exactly 300s on every fixture
    // larger than Dixon — that's the proxy's max-response-time, not a
    // function ceiling. Streaming SSE events flow continuously, so the
    // proxy sees data and doesn't terminate. We still wait for the final
    // message server-side and return JSON to the client unchanged.
    const stream = anthropic.messages.stream({
      model: DEFAULT_MODEL,
      // 64K covers 30+ page MECOs with full block emission. The original
      // 16K was hit by Hunnewell (22 MB / ~30 pp) — the model emitted a
      // partial tool_use with no `blocks` field because it exhausted
      // budget mid-emission. 64K is the practical ceiling for Sonnet 4.6
      // and gives generous headroom for the longest fixtures.
      max_tokens: 65536,
      system: PARSE_SYSTEM_PROMPT,
      tools: [emitDocumentStructureTool],
      tool_choice: { type: "tool", name: "emit_document_structure" },
      messages: [
        {
          role: "user",
          content: [
            pdfSource.documentContent,
            { type: "text", text: userText },
          ],
        },
      ],
    });
    const response = await stream.finalMessage();

    const toolUse = response.content.find(
      (block: { type: string; name?: string }) =>
        block.type === "tool_use" && block.name === "emit_document_structure",
    );
    if (!toolUse || toolUse.type !== "tool_use") {
      return {
        ok: false,
        reason: `Model did not emit emit_document_structure (stop_reason: ${response.stop_reason}; content types: ${response.content.map((c: { type: string }) => c.type).join(",")})`,
        shape: { stopReason: response.stop_reason },
      };
    }

    // Defensive coercion: Anthropic occasionally returns array-typed tool
    // fields as JSON-encoded strings (sometimes double-encoded). Build a new
    // object — toolUse.input is frozen.
    const rawInput = toolUse.input as Record<string, unknown>;
    let blocks: unknown = rawInput.blocks;
    for (let i = 0; i < 5 && typeof blocks === "string"; i++) {
      try {
        blocks = JSON.parse(blocks);
      } catch {
        break;
      }
    }
    const toolInput = { ...rawInput, blocks };

    const validation = parsedDocumentSchema.safeParse(toolInput);
    if (!validation.success) {
      const isMaxTokens = response.stop_reason === "max_tokens";
      return {
        ok: false,
        reason: isMaxTokens
          ? `Token budget exhausted (stop_reason=max_tokens). The PDF needs more output tokens than the current 65536 budget allows.`
          : `validation failed: ${validation.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")}`,
        shape: {
          stopReason: response.stop_reason,
          rawInputKeys: Object.keys(rawInput),
          blocksType: typeof toolInput.blocks,
          blocksIsArray: Array.isArray(toolInput.blocks),
          blocksLength: Array.isArray(toolInput.blocks)
            ? (toolInput.blocks as unknown[]).length
            : undefined,
          preview:
            typeof toolInput.blocks === "string"
              ? (toolInput.blocks as string).slice(0, 300)
              : undefined,
        },
      };
    }
    return { ok: true, data: validation.data };
  }

  // Streamed response. Long parses on real-world PDFs run 5–10 minutes
  // end-to-end — well past the proxy's per-request response-time cap (300s)
  // and Vercel Hobby's function maxDuration (300s). Returning a Server-Sent
  // Events response with periodic keepalive bytes keeps the connection
  // alive on both sides: the proxy sees data flowing every few seconds, and
  // Vercel doesn't kill streaming functions while bytes are still being
  // emitted. Final result + errors come back as named SSE events that the
  // client (DocPane) consumes. Cache hits + probe failures (above) take
  // the fast plain-JSON path and don't touch this code.
  const encoder = new TextEncoder();
  const sse = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, payload: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
        );
      };
      // Keepalive ping every 10s. Comments (lines starting with `:`) are
      // SSE-spec idle markers — no event delivered to client, just bytes
      // on the wire to keep proxies + load balancers happy.
      const ping = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`)); }
        catch { /* controller closed */ }
      }, 10_000);

      try {
        send("status", { stage: "parsing", message: "Sending PDF to Claude…" });

        // Try up to 2 attempts (same retry policy as before — handles the
        // occasional blocks-as-stringified-JSON quirk).
        let lastFailure: AttemptResult | null = null;
        let validated: z.infer<typeof parsedDocumentSchema> | null = null;
        const retryHints = [
          undefined,
          "CRITICAL: Emit `blocks` as a TRUE JSON array — not as a JSON-encoded string. Output blocks: [{...}, {...}] not blocks: \"[...]\". Each block must be a separate object.",
        ];
        for (let attempt = 0; attempt < retryHints.length; attempt++) {
          if (attempt > 0) {
            send("status", {
              stage: "retry",
              attempt: attempt + 1,
              message: "Retrying with sharper instruction…",
              priorFailure: lastFailure
                ? { reason: lastFailure.reason, shape: lastFailure.shape }
                : null,
            });
          }
          let result: AttemptResult;
          try {
            result = await attemptParse(retryHints[attempt]);
          } catch (error) {
            const errResp = classifyAnthropicErrorAsNextResponse<ParseFailure>(error);
            const body = await errResp.json();
            send("error", body);
            return;
          }
          if (result.ok) { validated = result.data; break; }
          lastFailure = result;
        }

        if (!validated) {
          send("error", {
            ok: false,
            error: `Parse output failed after ${retryHints.length} attempts: ${
              lastFailure?.reason ?? "unknown error"
            }`,
            debug: lastFailure?.shape,
          });
          return;
        }

        // Enrich into a DocumentModel.
        const now = Date.now();
        const doc: DocumentModel = {
          blocks: validated.blocks.map((b, index) => ({
            id: nanoid(10),
            kind: b.kind,
            page: b.page,
            order: index,
            bboxHint: b.bboxHint,
            revisions: [{ text: b.text, source: "original" as const, createdAt: now }],
            editable: isEditableKind(b.kind),
          })),
          history: [],
          redoStack: [],
        };

        // Persist to cache (best-effort).
        await setCachedParse(body.hash, doc);

        send("result", { ok: true, cached: false, doc });
      } catch (error) {
        send("error", {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        clearInterval(ping);
        controller.close();
      }
    },
  });

  return new Response(sse, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
