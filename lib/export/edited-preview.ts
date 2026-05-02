/**
 * V1.6: in-viewer "Edited" preview PDF generator.
 *
 * Distinct from `lib/export/annotated.ts`. The annotated exporter is for
 * download — it draws numbered orange markers in the page margin and appends
 * a Changes Summary page. This generator is for the live in-app preview that
 * the PDF pane swaps to when the user toggles to Edited mode: a soft yellow
 * highlight over each edited block's bbox, nothing else. No markers, no
 * margins, no summary page. The PDF should look like the original with the
 * edited regions visibly tinted.
 *
 * The export pipeline keeps using the clean / annotated / markdown variants
 * as before. This file is invoked only by `app/api/preview-pdf/route.ts`.
 *
 * Confidence gate matches annotated export: bboxResolved.confidence ≥ 0.6.
 * Below that we silently skip — drawing on the wrong region is worse than
 * not drawing.
 */

import { PDFDocument, rgb } from "pdf-lib";

import type { DocumentModel } from "../doc-model";
import { pdfJsBboxToPdfLibRect } from "../pdf-coords";

const HIGHLIGHT_COLOR = rgb(1.0, 0.92, 0.4); // soft pencil-yellow
const HIGHLIGHT_OPACITY = 0.35;
const HIGHLIGHT_PADDING = 1.5;
const MIN_CONFIDENCE = 0.6;

export interface EditedPreviewInput {
  originalPdfBytes: ArrayBuffer | Uint8Array;
  doc: DocumentModel;
}

export async function buildEditedPreviewPdf(
  input: EditedPreviewInput,
): Promise<Uint8Array> {
  const { originalPdfBytes, doc } = input;

  const pdf = await PDFDocument.load(originalPdfBytes);
  pdf.setProducer("Buoyant Proposal Editor — Edited Preview");

  const editedBlockIds = new Set(
    doc.history
      .filter((h) => h.status === "accepted")
      .map((h) => h.blockId),
  );

  const pages = pdf.getPages();

  for (const block of doc.blocks) {
    if (!editedBlockIds.has(block.id)) continue;
    const resolved = block.bboxResolved;
    if (!resolved) continue;
    if (resolved.confidence < MIN_CONFIDENCE) continue;

    const page = pages[resolved.page - 1];
    if (!page) continue;

    const rect = pdfJsBboxToPdfLibRect(resolved, page.getHeight());

    page.drawRectangle({
      x: rect.x - HIGHLIGHT_PADDING,
      y: rect.y - HIGHLIGHT_PADDING,
      width: rect.width + HIGHLIGHT_PADDING * 2,
      height: rect.height + HIGHLIGHT_PADDING * 2,
      color: HIGHLIGHT_COLOR,
      opacity: HIGHLIGHT_OPACITY,
    });
  }

  return pdf.save();
}
