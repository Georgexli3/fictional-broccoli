import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";

import { anthropic, DEFAULT_MODEL } from "@/lib/anthropic";
import { buildPdfDocumentSource } from "@/lib/anthropic-pdf";
import { isEditableKind, type DocumentModel } from "@/lib/doc-model";
import { parsedDocumentSchema } from "@/lib/doc-model-zod";
import { getCachedParse, setCachedParse } from "@/lib/kv";
import {
  emitDocumentStructureTool,
  PARSE_SYSTEM_PROMPT,
  PARSE_USER_PROMPT,
} from "@/lib/parse-prompt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

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
export async function POST(request: Request): Promise<NextResponse<ParseResponse>> {
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

  // 2. Send to Claude.
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
    const response = await anthropic.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 16384,
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

    const toolUse = response.content.find(
      (block) =>
        block.type === "tool_use" && block.name === "emit_document_structure",
    );
    if (!toolUse || toolUse.type !== "tool_use") {
      return {
        ok: false,
        reason: "Model did not emit emit_document_structure",
        shape: {},
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
      return {
        ok: false,
        reason: `validation failed: ${validation.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
        shape: {
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

  // Try up to 2 attempts. Anthropic occasionally returns the `blocks` array
  // as a JSON-encoded string (sometimes with malformed inner quotes that
  // break JSON.parse); a retry usually produces a clean array. We cap at 2
  // (down from 3) because each attempt on a complex PDF can take 60-120s,
  // and 3 attempts on a multi-section doc can exceed Vercel's 300s function
  // ceiling on the Hobby plan. 2 attempts ≈ 75% success on a 50% success
  // rate per call — good enough for V1; streaming parse (V1.5) eliminates
  // the timeout class entirely.
  let lastFailure: AttemptResult | null = null;
  let validation: { success: true; data: z.infer<typeof parsedDocumentSchema> } | null =
    null;
  const retryHints = [
    undefined,
    "CRITICAL: Emit `blocks` as a TRUE JSON array — not as a JSON-encoded string. Output blocks: [{...}, {...}] not blocks: \"[...]\". Each block must be a separate object.",
  ];
  for (let attempt = 0; attempt < retryHints.length; attempt++) {
    let result: AttemptResult;
    try {
      result = await attemptParse(retryHints[attempt]);
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error: `Anthropic call failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
        { status: 502 },
      );
    }
    if (result.ok) {
      validation = { success: true, data: result.data };
      break;
    }
    lastFailure = result;
  }

  if (!validation) {
    return NextResponse.json(
      {
        ok: false,
        error: `Parse output failed after ${retryHints.length} attempts: ${
          lastFailure?.reason ?? "unknown error"
        }`,
        debug: lastFailure?.shape,
      },
      { status: 502 },
    );
  }

  // 4. Enrich into a DocumentModel.
  const now = Date.now();
  const doc: DocumentModel = {
    blocks: validation.data.blocks.map((b, index) => ({
      id: nanoid(10),
      kind: b.kind,
      page: b.page,
      order: index,
      bboxHint: b.bboxHint,
      revisions: [
        {
          text: b.text,
          source: "original" as const,
          createdAt: now,
        },
      ],
      editable: isEditableKind(b.kind),
    })),
    history: [],
    redoStack: [],
  };

  // 5. Persist to cache (best-effort).
  await setCachedParse(body.hash, doc);

  return NextResponse.json({ ok: true, cached: false, doc });
}
