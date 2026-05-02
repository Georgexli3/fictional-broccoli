import { describe, expect, it } from "vitest";

import {
  currentText,
  isEditableKind,
  originalText,
  type Block,
  type DocumentModel,
} from "@/lib/doc-model";

function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: "b1",
    kind: "paragraph",
    page: 1,
    order: 0,
    revisions: [
      { text: "Original text.", source: "original", createdAt: 1 },
    ],
    editable: true,
    ...overrides,
  };
}

describe("doc-model utilities", () => {
  it("currentText returns the most-recent revision", () => {
    const block = makeBlock({
      revisions: [
        { text: "v0", source: "original", createdAt: 1 },
        { text: "v1", source: "edit", createdAt: 2, editId: "e1" },
        { text: "v2", source: "edit", createdAt: 3, editId: "e2" },
      ],
    });
    expect(currentText(block)).toBe("v2");
  });

  it("originalText returns the original revision regardless of subsequent edits", () => {
    const block = makeBlock({
      revisions: [
        { text: "v0", source: "original", createdAt: 1 },
        { text: "v1", source: "edit", createdAt: 2, editId: "e1" },
      ],
    });
    expect(originalText(block)).toBe("v0");
  });

  it("isEditableKind allows paragraph, heading, list_item, cover, caption", () => {
    expect(isEditableKind("paragraph")).toBe(true);
    expect(isEditableKind("heading")).toBe(true);
    expect(isEditableKind("list_item")).toBe(true);
    expect(isEditableKind("cover")).toBe(true);
    expect(isEditableKind("caption")).toBe(true);
  });

  it("isEditableKind blocks header_footer, figure, table", () => {
    expect(isEditableKind("header_footer")).toBe(false);
    expect(isEditableKind("figure")).toBe(false);
    expect(isEditableKind("table")).toBe(false);
  });

  it("DocumentModel revisions stack correctly across multiple edits to the same block", () => {
    // We're testing the *shape* the session store produces, not the store
    // itself (which involves React). The shape is: revisions is append-only,
    // history is append-only, currentText returns the top.
    const initial: DocumentModel = {
      blocks: [
        makeBlock({
          revisions: [{ text: "v0", source: "original", createdAt: 1 }],
        }),
      ],
      history: [],
      redoStack: [],
    };
    const afterE1: DocumentModel = {
      ...initial,
      blocks: initial.blocks.map((b) => ({
        ...b,
        revisions: [
          ...b.revisions,
          { text: "v1", source: "edit" as const, createdAt: 2, editId: "e1" },
        ],
      })),
      history: [
        {
          id: "e1",
          blockId: "b1",
          intent: "tighten" as const,
          status: "accepted" as const,
          beforeText: "v0",
          afterText: "v1",
          createdAt: 2,
        },
      ],
    };
    expect(currentText(afterE1.blocks[0]!)).toBe("v1");
    expect(originalText(afterE1.blocks[0]!)).toBe("v0");
    expect(afterE1.history).toHaveLength(1);
  });
});
