import { list, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";

import { documentModelSchema } from "@/lib/doc-model-zod";
import { hasBlob } from "@/lib/env";
import { buildEditedPreviewPdf } from "@/lib/export/edited-preview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const requestBodySchema = z.object({
  /** Content hash of the original PDF — first segment of the cache key. */
  docHash: z.string().min(8),
  /** Vercel Blob URL of the original PDF. Server fetches bytes from here. */
  blobUrl: z.string().url(),
  /** Current doc state (used to compute highlights from accepted edits). */
  doc: documentModelSchema,
});

/**
 * V1.6: server-rendered preview of the PDF with yellow highlights at every
 * accepted-edit bbox. Powers the "Edited" toggle on the PDF pane.
 *
 * Cache key is `preview/{docHash}/{historyLen}.pdf` — deterministic given the
 * inputs, so once generated for a (docHash, historyLen) pair we never have
 * to regenerate. Repeated calls with the same key do a `list()` lookup and
 * skip the pdf-lib pass.
 *
 * The `usePreviewPdfRegen` hook calls this eagerly after every accepted
 * edit so the PDF pane has a fresh URL ready before the user toggles.
 */
export async function POST(request: Request) {
  if (!hasBlob) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Vercel Blob is not configured. Set BLOB_READ_WRITE_TOKEN (run `vercel env pull` after provisioning Blob in the dashboard).",
      },
      { status: 503 },
    );
  }

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

  const historyLen = body.doc.history.filter((h) => h.status === "accepted").length;
  // Version suffix in the cache key. Bump whenever the generator output changes
  // shape (e.g. V1.6 yellow box → V1.6.1 cover-and-replace) so previously
  // cached PDFs from older code paths aren't served.
  const pathname = `preview/${body.docHash}/${historyLen}-v2.pdf`;

  // Cache hit: the deterministic pathname has been generated before. Vercel
  // Blob keys are unique within a store, so a single result here is the
  // canonical URL for this (docHash, historyLen) pair.
  try {
    const existing = await list({ prefix: pathname, limit: 1 });
    const hit = existing.blobs.find((b) => b.pathname === pathname);
    if (hit) {
      return NextResponse.json({ ok: true, url: hit.url, cached: true });
    }
  } catch (error) {
    // Cache lookup is best-effort; fall through to regenerate if it fails.
    console.warn("[preview-pdf] list() failed, regenerating", error);
  }

  // Cache miss: fetch original, generate highlights, upload.
  let originalBytes: ArrayBuffer;
  try {
    const response = await fetch(body.blobUrl);
    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Failed to fetch original PDF: HTTP ${response.status}`,
        },
        { status: 502 },
      );
    }
    originalBytes = await response.arrayBuffer();
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: `Fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 502 },
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await buildEditedPreviewPdf({
      originalPdfBytes: originalBytes,
      doc: body.doc,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: `pdf-lib generation failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 },
    );
  }

  try {
    const uploaded = await put(pathname, bytes as unknown as ArrayBuffer, {
      access: "public",
      contentType: "application/pdf",
      addRandomSuffix: false,
      // Same (docHash, historyLen) → same bytes; allow no-op overwrite for the
      // race-condition where two tabs regenerate concurrently.
      allowOverwrite: true,
    });
    return NextResponse.json({ ok: true, url: uploaded.url, cached: false });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: `Upload failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 },
    );
  }
}
