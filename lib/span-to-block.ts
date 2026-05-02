/**
 * Span-to-block mapping (Pattern E from the V1.5 plan).
 *
 * Pure function used by:
 *   1. PdfPage span-stamping: walk the PDF.js text-layer spans and stamp
 *      `data-block-id` on each, so PDF→Doc reverse linking can identify
 *      which block a click landed in.
 *   2. PdfPage click handler: a redundant lookup in case a span isn't
 *      stamped (defensive).
 *
 * Uses `bboxResolved` from the doc model. Skips low-confidence (<0.4) blocks.
 * Edit overlays use a stricter ≥0.6 gate; the looser 0.4 here lets clicks
 * still land in regions the overlay wouldn't draw markers for.
 */

import type { Block } from "./doc-model";

/**
 * Find the id of the block whose resolved bbox contains `(x, y)`.
 * Coordinates are at PDF.js scale=1 (the resolver's reference frame).
 *
 * Returns the FIRST containing block — if bboxes overlap (unusual; the
 * resolver tries to avoid this), the earliest in `blocksOnPage` wins.
 * Skips blocks without `bboxResolved` or with confidence < 0.4.
 */
export function findBlockContainingPoint(
  blocksOnPage: readonly Block[],
  xAt1: number,
  yAt1: number,
): string | null {
  for (const b of blocksOnPage) {
    const r = b.bboxResolved;
    if (!r || r.confidence < 0.4) continue;
    if (xAt1 >= r.x && xAt1 <= r.x + r.w && yAt1 >= r.y && yAt1 <= r.y + r.h) {
      return b.id;
    }
  }
  return null;
}
