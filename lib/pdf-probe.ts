/**
 * V1.7.1: lightweight pre-flight probe for uploaded PDFs.
 *
 * Catches the two failure classes that would otherwise burn an Anthropic call
 * and return a useless error to the user:
 *
 *   1. Encrypted / password-protected PDFs — pdf-lib throws on `.load()`
 *      unless `ignoreEncryption: true`. We detect the throw and return a
 *      friendly message pointing the user at decryption.
 *   2. Image-only / scanned PDFs — no text glyphs in the content streams.
 *      Claude's vision can sometimes extract text from scans, but the parse
 *      is much slower and lower-quality. We warn upstream so the user knows
 *      what they're getting before they wait.
 *
 * Cost: one fetch (Vercel Blob → Vercel function, same region) + one pdf-lib
 * `.load()`. ≈ 200–500 ms. Saves the ~60–120 s Claude call on bad inputs.
 *
 * Not a full validation — pdf-lib accepts many subtly-broken PDFs that
 * Claude will then refuse. The probe is best-effort.
 */

import { PDFDocument } from "pdf-lib";

export type PdfProbeResult =
  | { ok: true; pageCount: number; warning?: string }
  | { ok: false; reason: string };

const MIN_TEXT_OPS_FOR_TEXT_LAYER = 5;

export async function probePdf(blobUrl: string): Promise<PdfProbeResult> {
  let bytes: ArrayBuffer;
  try {
    const response = await fetch(blobUrl);
    if (!response.ok) {
      return {
        ok: false,
        reason: `Could not fetch the uploaded PDF (HTTP ${response.status}). Try re-uploading.`,
      };
    }
    bytes = await response.arrayBuffer();
  } catch (error) {
    return {
      ok: false,
      reason: `Could not fetch the uploaded PDF: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  // Encryption check — if the PDF is encrypted, pdf-lib throws unless we
  // explicitly opt in to ignoring encryption. We do NOT pass that flag here
  // because the probe's job is to surface the encrypted-PDF case.
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/encrypt|password/i.test(message)) {
      return {
        ok: false,
        reason:
          "This PDF appears to be encrypted or password-protected. Decrypt it first (e.g. File → Export As in Preview, or via Acrobat) and try again.",
      };
    }
    return {
      ok: false,
      reason: `PDF could not be opened: ${message}`,
    };
  }

  const pageCount = pdf.getPageCount();
  if (pageCount === 0) {
    return {
      ok: false,
      reason: "This PDF has zero pages. The file may be corrupt.",
    };
  }

  // Image-only / scanned heuristic. pdf-lib doesn't expose decoded text
  // directly, but content stream length is a useful proxy: a text-layer
  // PDF has thousands of text-show operators per page; a scanned PDF has
  // a single image XObject and almost no operators.
  //
  // We sample the first three pages' content stream sizes — pages full of
  // glyph runs produce ~kilobytes per page; image-only pages produce a
  // handful of bytes for the image XObject reference.
  const sampleCount = Math.min(3, pageCount);
  let totalContentBytes = 0;
  for (let i = 0; i < sampleCount; i++) {
    const page = pdf.getPage(i);
    const contentStreamRef = page.node.Contents();
    if (!contentStreamRef) continue;
    // The lookup returns a PDFRawStream/PDFStream/PDFArray; sum the encoded
    // length we can reach via the public-ish `dict` API.
    try {
      const streamLength =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (contentStreamRef as any)?.contents?.length ?? 0;
      totalContentBytes += typeof streamLength === "number" ? streamLength : 0;
    } catch {
      // Best-effort; ignore.
    }
  }

  // Threshold tuned empirically: text-layer PDFs hit > 1 KB per sampled page
  // even on light pages. Image-only PDFs typically come in below 200 B per
  // page since the actual image lives in an XObject elsewhere.
  const avgBytesPerPage = totalContentBytes / sampleCount;
  if (totalContentBytes > 0 && avgBytesPerPage < MIN_TEXT_OPS_FOR_TEXT_LAYER * 100) {
    return {
      ok: true,
      pageCount,
      warning:
        "This looks like a scanned / image-only PDF. Parsing may be slower and less accurate — the model will OCR the pages, but the structural extraction won't be as reliable as on a digital text PDF.",
    };
  }

  return { ok: true, pageCount };
}
