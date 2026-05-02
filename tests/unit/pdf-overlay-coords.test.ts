import { describe, expect, it } from "vitest";

import { bboxToOverlayStyle } from "@/lib/pdf-coords";

describe("bboxToOverlayStyle", () => {
  it("scale=1 returns bbox values verbatim as px", () => {
    expect(bboxToOverlayStyle({ x: 10, y: 20, w: 100, h: 30 }, 1)).toEqual({
      left: "10px",
      top: "20px",
      width: "100px",
      height: "30px",
    });
  });

  it("scale=1.2 multiplies all four dimensions", () => {
    expect(bboxToOverlayStyle({ x: 10, y: 20, w: 100, h: 30 }, 1.2)).toEqual({
      left: "12px",
      top: "24px",
      width: "120px",
      height: "36px",
    });
  });

  it("scale=2.5 — large zoom keeps proportions", () => {
    expect(bboxToOverlayStyle({ x: 4, y: 8, w: 40, h: 16 }, 2.5)).toEqual({
      left: "10px",
      top: "20px",
      width: "100px",
      height: "40px",
    });
  });

  it("zero-size bbox does not crash", () => {
    expect(bboxToOverlayStyle({ x: 0, y: 0, w: 0, h: 0 }, 1.5)).toEqual({
      left: "0px",
      top: "0px",
      width: "0px",
      height: "0px",
    });
  });
});
