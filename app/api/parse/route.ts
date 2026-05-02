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
  let pdfSource;
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

  let response;
  try {
    response = await anthropic.messages.create({
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
            { type: "text", text: PARSE_USER_PROMPT },
          ],
        },
      ],
    });
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

  // 3. Extract + validate the tool call.
  const toolUse = response.content.find(
    (block) =>
      block.type === "tool_use" && block.name === "emit_document_structure",
  );
  if (!toolUse || toolUse.type !== "tool_use") {
    return NextResponse.json(
      {
        ok: false,
        error: "Model did not emit emit_document_structure",
      },
      { status: 502 },
    );
  }

  // Defensive coercion: Anthropic occasionally returns array-typed tool
  // fields as JSON-encoded strings rather than actual arrays despite strict
  // input_schema. Same failure mode build-kb.ts handles.
  // Sometimes the string is double-encoded — unwrap until we get an array.
  const toolInput = toolUse.input as Record<string, unknown>;
  let blocks: unknown = toolInput.blocks;
  for (let i = 0; i < 5 && typeof blocks === "string"; i++) {
    try {
      blocks = JSON.parse(blocks);
    } catch {
      break;
    }
  }
  if (Array.isArray(blocks)) {
    toolInput.blocks = blocks;
  }

  const validation = parsedDocumentSchema.safeParse(toolInput);
  if (!validation.success) {
    // Surface the shape we actually saw so we can debug without re-running
    // the parse. Cheap insurance.
    const shape = {
      blocksType: typeof toolInput.blocks,
      blocksIsArray: Array.isArray(toolInput.blocks),
      blocksLength: Array.isArray(toolInput.blocks)
        ? (toolInput.blocks as unknown[]).length
        : undefined,
      preview:
        typeof toolInput.blocks === "string"
          ? (toolInput.blocks as string).slice(0, 200)
          : undefined,
    };
    return NextResponse.json(
      {
        ok: false,
        error: `Parse output failed schema validation: ${validation.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
        debug: shape,
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
