/**
 * Vercel Blob helpers.
 *
 * Client-direct upload pattern: the browser POSTs PDF bytes directly to Blob
 * storage using a short-lived token issued by `/api/blob-token`. This
 * sidesteps Vercel's 4.5 MB body limit on route handlers — every MECO PDF in
 * our fixture set (13–24 MB) would fail through a route handler.
 *
 * Server side, we only ever hold the URL; the bytes live in Blob.
 */

export const PDF_MIME = "application/pdf";

/** Anthropic's PDF support limit. We enforce client-side before upload. */
export const MAX_PDF_BYTES = 32 * 1024 * 1024; // 32 MB

export function isAcceptablePdfFile(file: File): {
  ok: true;
} | {
  ok: false;
  reason: string;
} {
  if (file.type !== PDF_MIME && !file.name.toLowerCase().endsWith(".pdf")) {
    return { ok: false, reason: "Only PDF files are supported." };
  }
  if (file.size > MAX_PDF_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      reason: `PDF is ${mb} MB. Max supported is 32 MB (Claude PDF input limit). Compress or split before uploading.`,
    };
  }
  if (file.size === 0) {
    return { ok: false, reason: "File appears to be empty." };
  }
  return { ok: true };
}
