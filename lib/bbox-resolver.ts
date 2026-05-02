/**
 * Bbox resolver — fuzzy text-match against the PDF.js text-layer dump.
 *
 * Why not just trust Claude's `bboxHint`: LLM-emitted geometry is the wrong
 * place to put trust. The PDF's text layer is ground truth. We anchor every
 * block to its actual position by substring-matching the block text into
 * the text-layer items.
 *
 * Confidence is computed as fraction of block characters matched. A block
 * with `<0.6` confidence gets no annotation marker — listed in the changes
 * summary only — to avoid drawing markers on the wrong region.
 *
 * V1 implementation is a sliding-window normalized-text match. Real-world
 * PDFs hit ligatures, soft hyphens, and column reading-order edge cases.
 * The normalizer below handles the most common cases; remaining failures
 * fall through to no-annotation.
 */

import type { PdfJsBbox } from "./pdf-coords";

export interface TextLayerItem {
  /** The text content of this glyph run. */
  str: string;
  /** PDF.js transform: [scaleX, skewX, skewY, scaleY, x, y]. */
  transform: number[];
  /** Width in viewport units. */
  width: number;
  /** Height in viewport units (we approximate from font size). */
  height: number;
}

export interface PageTextLayer {
  page: number;
  /** Page height in PDF.js viewport units. */
  pageHeight: number;
  items: TextLayerItem[];
}

export interface BboxResolution {
  bbox: PdfJsBbox;
  confidence: number;
}

/**
 * Resolve a block's bbox by fuzzy-matching its text into the PDF.js text
 * layer for its page. Returns `null` if no acceptable match was found.
 *
 * `expectedPage` is a hint from the parser; we search that page first,
 * fall back to nearby pages.
 */
export function resolveBlockBbox(
  blockText: string,
  layers: PageTextLayer[],
  expectedPage: number,
): BboxResolution | null {
  const normalizedQuery = normalize(blockText);
  if (normalizedQuery.length < 8) return null;

  // Search expected page first, then ±1, then any.
  const order = orderedPagesToTry(expectedPage, layers);

  let best: { match: MatchResult; layer: PageTextLayer } | null = null;
  for (const layer of order) {
    const match = findBestMatch(normalizedQuery, layer.items);
    if (!match) continue;
    if (!best || match.confidence > best.match.confidence) {
      best = { match, layer };
    }
    if (match.confidence > 0.95) break; // good enough
  }

  // Threshold is intentionally lower than the marker-draw cutoff (0.6).
  // Medium-confidence matches (>= 0.4) still help hover-link approximate the
  // right region; only high-confidence (>= 0.6) gets a drawn marker.
  if (!best || best.match.confidence < 0.4) return null;

  const bbox = computeItemsBbox(best.layer.items, best.match.startIdx, best.match.endIdx);
  return {
    bbox: { ...bbox, page: best.layer.page },
    confidence: best.match.confidence,
  };
}

interface MatchResult {
  startIdx: number;
  endIdx: number;
  confidence: number;
}

function findBestMatch(
  normalizedQuery: string,
  items: TextLayerItem[],
): MatchResult | null {
  // Build the normalized concatenated text + a map back to item indices.
  const charToItem: number[] = [];
  let concat = "";
  for (let i = 0; i < items.length; i++) {
    const part = normalize(items[i]!.str);
    for (let c = 0; c < part.length; c++) {
      charToItem.push(i);
      concat += part[c];
    }
    // Insert a space between items if the previous didn't end with whitespace.
    // This approximates word boundaries.
    if (
      i < items.length - 1 &&
      part.length > 0 &&
      part[part.length - 1] !== " "
    ) {
      charToItem.push(i);
      concat += " ";
    }
  }

  const idx = concat.indexOf(normalizedQuery);
  if (idx < 0) {
    // Fall back to a prefix match: try the first 60 chars.
    const prefix = normalizedQuery.slice(0, 60);
    if (prefix.length < 8) return null;
    const prefixIdx = concat.indexOf(prefix);
    if (prefixIdx < 0) return null;
    const startItem = charToItem[prefixIdx]!;
    const endItem = charToItem[Math.min(prefixIdx + prefix.length - 1, charToItem.length - 1)]!;
    return {
      startIdx: startItem,
      endIdx: endItem,
      confidence: prefix.length / normalizedQuery.length,
    };
  }

  const startItem = charToItem[idx]!;
  const endItem = charToItem[Math.min(idx + normalizedQuery.length - 1, charToItem.length - 1)]!;
  return {
    startIdx: startItem,
    endIdx: endItem,
    confidence: 1,
  };
}

function computeItemsBbox(
  items: TextLayerItem[],
  startIdx: number,
  endIdx: number,
): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = startIdx; i <= endIdx && i < items.length; i++) {
    const item = items[i]!;
    const [, , , , x, y] = item.transform;
    const top = (y ?? 0) - item.height;
    const left = x ?? 0;
    const right = left + item.width;
    const bottom = y ?? 0;
    if (left < minX) minX = left;
    if (top < minY) minY = top;
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function orderedPagesToTry(
  expected: number,
  layers: PageTextLayer[],
): PageTextLayer[] {
  const byPage = new Map<number, PageTextLayer>();
  for (const l of layers) byPage.set(l.page, l);
  const order: PageTextLayer[] = [];
  const seen = new Set<number>();
  const add = (n: number) => {
    if (seen.has(n)) return;
    const layer = byPage.get(n);
    if (layer) {
      order.push(layer);
      seen.add(n);
    }
  };
  add(expected);
  add(expected - 1);
  add(expected + 1);
  for (const l of layers) add(l.page);
  return order;
}

/**
 * Normalize text for matching. Lowercase, collapse whitespace, strip soft
 * hyphens and common ligature artifacts.
 */
function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/­/g, "") // soft hyphen
    .replace(/-\s+/g, "") // hyphenated line break
    .replace(/\s+/g, " ")
    .replace(/[​-‍﻿]/g, "") // zero-width
    .trim();
}
