import { describe, expect, it } from "vitest";

import type { Block, DocumentModel } from "@/lib/doc-model";
import { exportMarkdown } from "@/lib/export/markdown";

function block(
  kind: Block["kind"],
  text: string,
  overrides: Partial<Block> = {},
): Block {
  return {
    id: `b-${Math.random()}`,
    kind,
    page: 1,
    order: 0,
    revisions: [{ text, source: "original", createdAt: 1 }],
    editable: true,
    ...overrides,
  };
}

function doc(blocks: Block[]): DocumentModel {
  return { blocks, history: [], redoStack: [] };
}

describe("exportMarkdown", () => {
  it("renders headings as ## and paragraphs as plain text", () => {
    const md = exportMarkdown(
      doc([
        block("heading", "Project Approach"),
        block("paragraph", "We propose a phased delivery."),
      ]),
      "Test Doc",
    );
    expect(md).toContain("# Test Doc");
    expect(md).toContain("## Project Approach");
    expect(md).toContain("We propose a phased delivery.");
  });

  it("renders list items with - prefix", () => {
    const md = exportMarkdown(
      doc([block("list_item", "First requirement"), block("list_item", "Second requirement")]),
      "Test",
    );
    expect(md).toContain("- First requirement");
    expect(md).toContain("- Second requirement");
  });

  it("excludes header_footer and figure blocks", () => {
    const md = exportMarkdown(
      doc([
        block("paragraph", "Real content."),
        block("header_footer", "Page 5"),
        block("figure", "logo.png"),
      ]),
      "Test",
    );
    expect(md).toContain("Real content.");
    expect(md).not.toContain("Page 5");
    expect(md).not.toContain("logo.png");
  });

  it("renders captions in italics", () => {
    const md = exportMarkdown(
      doc([block("caption", "Figure 1: site map")]),
      "Test",
    );
    expect(md).toContain("*Figure 1: site map*");
  });
});
