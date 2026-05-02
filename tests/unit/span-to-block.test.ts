import { describe, expect, it } from "vitest";

import type { Block } from "@/lib/doc-model";
import { findBlockContainingPoint } from "@/lib/span-to-block";

function block(
  id: string,
  bbox: { x: number; y: number; w: number; h: number; confidence?: number },
): Block {
  return {
    id,
    kind: "paragraph",
    page: 1,
    order: 0,
    bboxResolved: {
      page: 1,
      x: bbox.x,
      y: bbox.y,
      w: bbox.w,
      h: bbox.h,
      confidence: bbox.confidence ?? 1,
    },
    revisions: [{ text: id, source: "original", createdAt: 0 }],
    editable: true,
  };
}

describe("findBlockContainingPoint", () => {
  it("returns the id when the point is inside one bbox", () => {
    const blocks = [block("a", { x: 10, y: 10, w: 50, h: 20 })];
    expect(findBlockContainingPoint(blocks, 30, 20)).toBe("a");
  });

  it("returns null when the point is outside all bboxes", () => {
    const blocks = [block("a", { x: 10, y: 10, w: 50, h: 20 })];
    expect(findBlockContainingPoint(blocks, 100, 100)).toBeNull();
  });

  it("returns null when there are no blocks", () => {
    expect(findBlockContainingPoint([], 10, 10)).toBeNull();
  });

  it("skips blocks with confidence < 0.4", () => {
    const blocks = [block("low", { x: 0, y: 0, w: 100, h: 100, confidence: 0.3 })];
    expect(findBlockContainingPoint(blocks, 50, 50)).toBeNull();
  });

  it("returns the first match when multiple bboxes overlap (insertion order wins)", () => {
    const blocks = [
      block("a", { x: 0, y: 0, w: 100, h: 100 }),
      block("b", { x: 10, y: 10, w: 80, h: 80 }), // nested inside a
    ];
    expect(findBlockContainingPoint(blocks, 50, 50)).toBe("a");
  });

  it("skips blocks with no bboxResolved", () => {
    const without: Block = {
      id: "no-bbox",
      kind: "paragraph",
      page: 1,
      order: 0,
      revisions: [{ text: "x", source: "original", createdAt: 0 }],
      editable: true,
    };
    expect(findBlockContainingPoint([without], 0, 0)).toBeNull();
  });

  it("treats edges as inside (≤ on both sides)", () => {
    const blocks = [block("a", { x: 10, y: 10, w: 20, h: 20 })];
    // Top-left corner
    expect(findBlockContainingPoint(blocks, 10, 10)).toBe("a");
    // Bottom-right corner
    expect(findBlockContainingPoint(blocks, 30, 30)).toBe("a");
  });
});
