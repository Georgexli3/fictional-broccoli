/**
 * PDF coordinate-system helpers.
 *
 * PDF.js viewports use a top-left origin, with y growing downward (web
 * convention). pdf-lib uses a bottom-left origin, with y growing upward
 * (PDF spec convention). Mixing them up is the #1 ship-blocker on
 * annotation features — markers land off-page or on the wrong page.
 *
 * All bbox-style data in our doc model is in PDF.js convention (the
 * resolver computes from the text layer). We flip to pdf-lib convention
 * once, in this module, when drawing onto a pdf-lib page.
 */

export interface PdfJsBbox {
  /** Page number, 1-indexed. */
  page: number;
  /** Top-left x in PDF.js viewport coords. */
  x: number;
  /** Top-left y in PDF.js viewport coords (y grows down). */
  y: number;
  /** Width in PDF.js viewport units. */
  w: number;
  /** Height in PDF.js viewport units. */
  h: number;
}

export interface PdfLibPoint {
  /** Bottom-left origin x. */
  x: number;
  /** Bottom-left origin y (y grows up). */
  y: number;
}

/**
 * Convert a PDF.js top-left bbox to a pdf-lib top-left point on a page of
 * the given height (in PDF points).
 *
 * `pageHeight` is `pdfDoc.getPage(idx).getHeight()` — measured in PDF points.
 *
 * Note: PDF.js's viewport coords are scaled (typically by `scale: 1.0` =
 * 1pt per unit). If `bbox` was computed at a different `scale`, divide each
 * value by that scale before calling this — we expect bbox at scale=1.
 */
export function pdfJsBboxToPdfLibTopLeft(
  bbox: Pick<PdfJsBbox, "x" | "y">,
  pageHeight: number,
): PdfLibPoint {
  return {
    x: bbox.x,
    y: pageHeight - bbox.y,
  };
}

/**
 * Convert a PDF.js bbox to the rectangle pdf-lib would draw with `drawRectangle`.
 * pdf-lib's `drawRectangle({ x, y, width, height })` takes the BOTTOM-left
 * corner.
 */
export function pdfJsBboxToPdfLibRect(
  bbox: PdfJsBbox,
  pageHeight: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: bbox.x,
    // PDF.js top-left's y, then move down by h to get the bottom-left:
    y: pageHeight - bbox.y - bbox.h,
    width: bbox.w,
    height: bbox.h,
  };
}
