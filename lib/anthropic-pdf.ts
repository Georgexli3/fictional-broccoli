/**
 * Anthropic PDF input — abstraction over URL-fetch vs. base64 vs. Files API.
 *
 * The hiring proxy SHOULD pass through Anthropic's native PDF support, but
 * we don't know which input form works until we test. This module lets us
 * swap with a single config flag (env override or runtime detection)
 * instead of rewriting the parse + edit routes.
 *
 * Strategy:
 *   1. URL primary — let the model fetch the PDF directly. Cheapest, fastest,
 *      no body-size pressure.
 *   2. Base64 fallback — download the PDF server-side, embed as base64. Works
 *      for any deployment but inflates request payload by ~33%.
 *   3. Files API fallback — upload PDF to Anthropic's beta files endpoint,
 *      reference by `file_id`. Cleanest for repeated reuse but unclear
 *      whether the proxy passes through the beta endpoints.
 *
 * V1 ships with URL primary + base64 fallback. Files API path is wired but
 * gated behind ANTHROPIC_PDF_MODE=files in env (not enabled by default).
 */

import type Anthropic from "@anthropic-ai/sdk";

import { anthropic } from "./anthropic";

type PdfMode = "url" | "base64" | "files";

const MODE: PdfMode =
  (process.env.ANTHROPIC_PDF_MODE as PdfMode | undefined) ?? "url";

export interface PdfDocumentSource {
  /** The block we attach to a `messages.create` `content` array. */
  documentContent: Anthropic.Messages.DocumentBlockParam;
  /** Whether the PDF was sent inline (as bytes) — useful for token accounting. */
  inline: boolean;
}

/**
 * Build a `messages.create` content block for a PDF source. Tries the
 * configured mode first; falls back through the cheaper modes on error.
 */
export async function buildPdfDocumentSource(input: {
  blobUrl: string;
  hash: string;
}): Promise<PdfDocumentSource> {
  const order: PdfMode[] =
    MODE === "url"
      ? ["url", "base64", "files"]
      : MODE === "base64"
        ? ["base64", "url", "files"]
        : ["files", "url", "base64"];

  let lastError: unknown = null;
  for (const mode of order) {
    try {
      const result = await tryMode(mode, input);
      return result;
    } catch (error) {
      lastError = error;
      // Try next mode.
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("All PDF input modes failed");
}

async function tryMode(
  mode: PdfMode,
  { blobUrl, hash }: { blobUrl: string; hash: string },
): Promise<PdfDocumentSource> {
  switch (mode) {
    case "url":
      // The SDK type for `source` lags behind the API; URL input is supported
      // by Claude but not yet in the SDK union. Cast through unknown.
      return {
        inline: false,
        documentContent: {
          type: "document",
          source: { type: "url", url: blobUrl } as unknown as Anthropic.Messages.DocumentBlockParam["source"],
        },
      };

    case "base64": {
      const response = await fetch(blobUrl);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch PDF from ${blobUrl}: HTTP ${response.status}`,
        );
      }
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      return {
        inline: true,
        documentContent: {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: base64,
          },
        },
      };
    }

    case "files": {
      const response = await fetch(blobUrl);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch PDF from ${blobUrl}: HTTP ${response.status}`,
        );
      }
      const buffer = await response.arrayBuffer();
      const file = new File([buffer], `${hash}.pdf`, {
        type: "application/pdf",
      });
      // The Files API is a beta endpoint; the SDK exposes it via `beta`.
      // Type-cast loosely because the SDK types may lag the API surface.
      const filesApi = (
        anthropic as unknown as {
          beta?: { files?: { upload: (params: unknown) => Promise<unknown> } };
        }
      ).beta?.files;
      if (!filesApi) {
        throw new Error("Files API not available on this client");
      }
      const uploaded = (await filesApi.upload({ file })) as { id: string };
      return {
        inline: false,
        documentContent: {
          type: "document",
          source: {
            type: "file",
            file_id: uploaded.id,
          } as unknown as Anthropic.Messages.DocumentBlockParam["source"],
        },
      };
    }
  }
}
