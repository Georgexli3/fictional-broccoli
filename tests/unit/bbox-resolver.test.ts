import { describe, expect, it } from "vitest";

import { resolveBlockBbox, type PageTextLayer } from "@/lib/bbox-resolver";

function makeItem(str: string, x: number, y: number, w: number, h = 12) {
  return {
    str,
    transform: [1, 0, 0, 1, x, y],
    width: w,
    height: h,
  };
}

describe("resolveBlockBbox", () => {
  it("finds an exact match on the expected page", () => {
    const layers: PageTextLayer[] = [
      {
        page: 1,
        pageHeight: 800,
        items: [
          makeItem("Project ", 50, 700, 60),
          makeItem("Approach ", 110, 700, 65),
          makeItem("for the City", 175, 700, 80),
        ],
      },
    ];
    const result = resolveBlockBbox(
      "Project Approach for the City",
      layers,
      1,
    );
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeGreaterThanOrEqual(0.95);
    expect(result!.bbox.page).toBe(1);
  });

  it("returns null for very short queries", () => {
    const layers: PageTextLayer[] = [
      {
        page: 1,
        pageHeight: 800,
        items: [makeItem("Hi", 0, 0, 10)],
      },
    ];
    expect(resolveBlockBbox("Hi", layers, 1)).toBeNull();
  });

  it("falls back to a prefix match when full text isn't found", () => {
    // The layer has the first ~60 chars of the block; the rest is missing
    // (simulating a hyphenated line break or column wrap that drops the tail).
    const layers: PageTextLayer[] = [
      {
        page: 1,
        pageHeight: 800,
        items: [
          makeItem(
            "The City of Hunnewell wastewater plant requires modernization to meet new environmental regulations.",
            0,
            0,
            500,
          ),
        ],
      },
    ];
    // Query contains the layer prefix plus an extra trailing fragment that
    // doesn't appear in the layer (simulates parsed text drift).
    const result = resolveBlockBbox(
      "The City of Hunnewell wastewater plant requires modernization to meet new environmental regulations and budget constraints in 2026.",
      layers,
      1,
    );
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeLessThan(1);
    expect(result!.confidence).toBeGreaterThan(0.4);
  });

  it("normalizes case differences", () => {
    const layers: PageTextLayer[] = [
      {
        page: 1,
        pageHeight: 800,
        items: [makeItem("ALPHA CM HAS THE EXPERIENCE", 0, 0, 200)],
      },
    ];
    const result = resolveBlockBbox(
      "Alpha CM has the experience",
      layers,
      1,
    );
    expect(result).not.toBeNull();
  });

  it("searches non-expected pages when no match on expected page", () => {
    const layers: PageTextLayer[] = [
      {
        page: 1,
        pageHeight: 800,
        items: [makeItem("This is page one content not the target", 0, 0, 200)],
      },
      {
        page: 2,
        pageHeight: 800,
        items: [makeItem("Target paragraph lives on page two", 0, 0, 200)],
      },
    ];
    const result = resolveBlockBbox(
      "Target paragraph lives on page two",
      layers,
      1,
    );
    expect(result).not.toBeNull();
    expect(result!.bbox.page).toBe(2);
  });
});
