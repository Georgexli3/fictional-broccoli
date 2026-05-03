import { describe, expect, it } from "vitest";

import { winAnsiSafe } from "@/lib/export/winansi-safe";

describe("winAnsiSafe", () => {
  it("preserves ASCII unchanged", () => {
    expect(winAnsiSafe("Hello, world! 123 (foo)")).toBe("Hello, world! 123 (foo)");
  });

  it("preserves Latin-1 supplement (accented letters)", () => {
    expect(winAnsiSafe("café résumé naïve façade")).toBe("café résumé naïve façade");
  });

  it("preserves the typography characters that WinAnsi/CP-1252 supports", () => {
    // Smart quotes, em/en dash, ellipsis, bullet — these all encode in
    // pdf-lib's standard fonts.
    expect(winAnsiSafe("“quoted” — dash – en … ellipsis • bullet"))
      .toBe("“quoted” — dash – en … ellipsis • bullet");
  });

  it("substitutes arrows with ASCII equivalents", () => {
    expect(winAnsiSafe("A → B ← C ↔ D")).toBe("A -> B <- C <-> D");
  });

  it("substitutes geometric and check marks", () => {
    expect(winAnsiSafe("✓ done · ✗ fail")).toBe("v done · x fail");
  });

  it("replaces unsupported CJK / Cyrillic with question marks (no crash)", () => {
    const out = winAnsiSafe("公司 Москва Αθήνα");
    expect(out).not.toContain("公");
    expect(out).not.toContain("М");
    expect(out).toMatch(/\?/);
  });

  it("strips zero-width characters", () => {
    expect(winAnsiSafe("a​b‌c‍d﻿e")).toBe("abcde");
  });

  it("converts ideographic space to two ASCII spaces", () => {
    expect(winAnsiSafe("a　b")).toBe("a  b");
  });

  it("never returns a character that would crash WinAnsi encoding", () => {
    // Sample the full BMP range; ensure every output character is ASCII or
    // Latin-1 or one of the 27 CP-1252 extras.
    const winAnsiExtras = new Set([
      0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
      0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
      0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
    ]);
    const sample = "ABC→公️🎉Москва€™×÷±≠";
    const out = winAnsiSafe(sample);
    for (const ch of out) {
      const cp = ch.codePointAt(0)!;
      const ok =
        (cp >= 0x20 && cp <= 0x7e) ||
        cp === 0x09 || cp === 0x0a || cp === 0x0d ||
        (cp >= 0xa0 && cp <= 0xff) ||
        winAnsiExtras.has(cp);
      expect(ok, `code point 0x${cp.toString(16)} would crash WinAnsi`).toBe(true);
    }
  });
});
