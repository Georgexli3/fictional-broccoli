import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { hasBlob } from "@/lib/env";

/**
 * Issues a short-lived upload token to the browser so PDF bytes go directly
 * to Vercel Blob storage. Sidesteps Vercel's 4.5 MB body cap on route
 * handlers — uploads of 13–24 MB MECO PDFs would silently fail otherwise.
 *
 * Validates: Content-Type must be `application/pdf`. Max size enforced
 * client-side; we don't trust it but the client check is the friendly path.
 *
 * The `clientPayload` carries `{ hash, size }` from the browser. We stash
 * `hash` into the `tokenPayload` so `onUploadCompleted` could persist a
 * mapping if needed (V2: write to KV `blob:hash → url` for cross-device
 * resume). For V1 the client owns its session in localStorage.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasBlob) {
    return NextResponse.json(
      {
        error:
          "Vercel Blob is not configured. Set BLOB_READ_WRITE_TOKEN (run `vercel env pull` after provisioning Blob in the dashboard).",
      },
      { status: 503 },
    );
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        // clientPayload is a stringified JSON: { hash, size, filename }
        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: 32 * 1024 * 1024,
          tokenPayload: clientPayload ?? "",
          // Path is content-addressed by hash, so re-uploading the same PDF
          // would otherwise hit "blob already exists". Identical bytes
          // overwrite themselves; URL stays stable; KV parse cache still hits.
          allowOverwrite: true,
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Hook for V2: persist `blob:hash → blob.url` mapping in KV.
        // For V1 the client navigates with `blob.url` in localStorage.
        console.log("[blob-token] upload completed", {
          url: blob.url,
          tokenPayload,
        });
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
