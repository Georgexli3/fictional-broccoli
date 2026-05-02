import { NextResponse } from "next/server";
import { z } from "zod";

import { documentModelSchema } from "@/lib/doc-model-zod";
import { exportAnnotatedPdf } from "@/lib/export/annotated";
import { exportCleanPdf } from "@/lib/export/clean";
import { exportMarkdown } from "@/lib/export/markdown";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const requestBodySchema = z.object({
  format: z.enum(["markdown", "clean", "annotated"]),
  title: z.string().default("Edited Proposal"),
  doc: documentModelSchema,
  /** For 'annotated' format only — ignored otherwise. */
  blobUrl: z.string().url().optional(),
});

/**
 * Export endpoint.
 *
 * Client POSTs the doc model + format. We serialize and stream back the
 * appropriate file as the response body. Client kicks off a download via a
 * Blob + anchor href.
 *
 * V1: markdown + clean PDF formats. M10 adds annotated original.
 */
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

  switch (body.format) {
    case "markdown": {
      const md = exportMarkdown(body.doc, body.title);
      return new Response(md, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${slug(body.title)}.md"`,
          "Cache-Control": "no-store",
        },
      });
    }
    case "clean": {
      const bytes = await exportCleanPdf(body.doc, body.title);
      return new Response(new Blob([bytes as unknown as ArrayBuffer], { type: "application/pdf" }), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${slug(body.title)}-clean.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    }
    case "annotated": {
      if (!body.blobUrl) {
        return NextResponse.json(
          { ok: false, error: "Annotated export requires blobUrl" },
          { status: 400 },
        );
      }
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

      const bytes = await exportAnnotatedPdf({
        originalPdfBytes: originalBytes,
        doc: body.doc,
        title: body.title,
      });
      return new Response(new Blob([bytes as unknown as ArrayBuffer], { type: "application/pdf" }), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${slug(body.title)}-annotated.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    }
  }
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
