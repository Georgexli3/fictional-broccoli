/**
 * V1.6: in-viewer "Edited" preview PDF + matching export format.
 *
 * Loads the original PDF and, for each block with an accepted edit and a
 * resolved bbox above the confidence floor, COVERS the original text with a
 * white rectangle and DRAWS the edited text in its place using Helvetica.
 * This is in-place text replacement, not an overlay highlight — so the PDF
 * actually looks like the original with the user's edits applied.
 *
 * Two callers:
 *   1. `app/api/preview-pdf/route.ts` — passes `showIndicator: true` to draw
 *      a thin amber bar in the left margin of each edited block (Word-style
 *      track-changes indicator). Used by the in-app Edited toggle.
 *   2. `app/api/export/route.ts` for `format: "edited-original"` — passes
 *      `showIndicator: false` so the downloaded PDF has no markup, just the
 *      edits typeset over the original layout.
 *
 * Limitations:
 *   - Helvetica won't perfectly match the original font.
 *   - Multi-line edits are wrapped greedily; long edits at small bbox heights
 *     are truncated with an ellipsis rather than overflowing.
 *   - Confidence floor is 0.7 — below that we skip entirely. Better to leave
 *     a region untouched than to cover the wrong paragraph with edit text.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";

import { currentText, type DocumentModel } from "../doc-model";
import { pdfJsBboxToPdfLibRect } from "../pdf-coords";

const MIN_CONFIDENCE = 0.7;
const COVER_PADDING = 1.5;
const MARKER_BAR_COLOR = rgb(0.95, 0.65, 0.1); // warm amber
const MARKER_BAR_WIDTH = 3;
const MARKER_BAR_GAP = 6;
const TEXT_COLOR = rgb(0.1, 0.1, 0.1);
const FONT_SIZES = [11, 10.5, 10, 9.5, 9, 8.5, 8];

export interface EditedPreviewOptions {
  /**
   * If true (default), draws a thin amber bar in the page margin next to
   * each edited block. The export format passes `false` so the downloaded
   * PDF has no review markup.
   */
  showIndicator?: boolean;
}

export interface EditedPreviewInput {
  originalPdfBytes: ArrayBuffer | Uint8Array;
  doc: DocumentModel;
  options?: EditedPreviewOptions;
}

export async function buildEditedPreviewPdf(
  input: EditedPreviewInput,
): Promise<Uint8Array> {
  const { originalPdfBytes, doc, options = {} } = input;
  const showIndicator = options.showIndicator ?? true;

  const pdf = await PDFDocument.load(originalPdfBytes);
  pdf.setProducer("Buoyant Proposal Editor — Edited PDF");

  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();

  // Block has an edit if its revisions stack grew past the parsed original.
  const editedBlocks = doc.blocks.filter(
    (b) =>
      b.revisions.length > 1 &&
      b.bboxResolved !== undefined &&
      b.bboxResolved.confidence >= MIN_CONFIDENCE,
  );

  for (const block of editedBlocks) {
    const resolved = block.bboxResolved!;
    const page = pages[resolved.page - 1];
    if (!page) continue;

    const rect = pdfJsBboxToPdfLibRect(resolved, page.getHeight());
    const newText = currentText(block);
    if (!newText.trim()) continue;

    coverAndReplace(page, rect, newText, helvetica);
    if (showIndicator) drawMarginBar(page, rect);
  }

  return pdf.save();
}

function coverAndReplace(
  page: PDFPage,
  rect: { x: number; y: number; width: number; height: number },
  text: string,
  font: PDFFont,
): void {
  // Paint over the original glyphs. Pad slightly so descenders/ascenders are
  // covered when the bbox is computed from text-layer baselines.
  page.drawRectangle({
    x: rect.x - COVER_PADDING,
    y: rect.y - COVER_PADDING,
    width: rect.width + COVER_PADDING * 2,
    height: rect.height + COVER_PADDING * 2,
    color: rgb(1, 1, 1),
  });

  // Find the largest size at which the wrapped text fits within rect.height.
  // Higher sizes look closer to original body text; we shrink only when the
  // edit is meaningfully longer than the original.
  for (const size of FONT_SIZES) {
    const lines = wrap(text, font, size, rect.width);
    const lineHeight = size * 1.25;
    if (lines.length * lineHeight <= rect.height + 1) {
      let y = rect.y + rect.height - lineHeight + (lineHeight - size) / 3;
      for (const line of lines) {
        page.drawText(line, { x: rect.x, y, size, font, color: TEXT_COLOR });
        y -= lineHeight;
      }
      return;
    }
  }

  // Fallback: text exceeds the bbox at every size. Draw at the smallest size
  // and truncate the last visible line with an ellipsis. Better to clip than
  // to overflow into the next paragraph below.
  const size = 8;
  const lineHeight = size * 1.25;
  const lines = wrap(text, font, size, rect.width);
  const maxLines = Math.max(1, Math.floor(rect.height / lineHeight));
  let y = rect.y + rect.height - lineHeight;
  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    let line = lines[i]!;
    if (i === maxLines - 1 && i < lines.length - 1) {
      line = truncate(line, font, size, rect.width);
    }
    page.drawText(line, { x: rect.x, y, size, font, color: TEXT_COLOR });
    y -= lineHeight;
  }
}

function drawMarginBar(
  page: PDFPage,
  rect: { x: number; y: number; width: number; height: number },
): void {
  const barX = Math.max(2, rect.x - MARKER_BAR_GAP - MARKER_BAR_WIDTH);
  page.drawRectangle({
    x: barX,
    y: rect.y - 1,
    width: MARKER_BAR_WIDTH,
    height: rect.height + 2,
    color: MARKER_BAR_COLOR,
    opacity: 0.85,
  });
}

function wrap(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function truncate(
  line: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string {
  const ellipsis = "…";
  if (font.widthOfTextAtSize(line + ellipsis, size) <= maxWidth) {
    return line + ellipsis;
  }
  let cur = line;
  while (
    cur.length > 1 &&
    font.widthOfTextAtSize(cur + ellipsis, size) > maxWidth
  ) {
    cur = cur.slice(0, -1);
  }
  return cur + ellipsis;
}
