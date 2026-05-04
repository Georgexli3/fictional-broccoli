import { describe, expect, it } from "vitest";
import JSZip from "jszip";

import type { Block, DocumentModel } from "@/lib/doc-model";
import { exportDocx } from "@/lib/export/docx";

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
    editable: true,
    revisions: [{ text, source: "original", createdAt: 1 }],
    ...overrides,
  };
}

function docWithEdit(): DocumentModel {
  const b = block("paragraph", "The quick brown fox jumps over the lazy dog.");
  b.revisions.push({
    text: "The fast brown fox leaps over the sleepy dog.",
    source: "edit",
    editId: "e1",
    createdAt: 2,
  });
  return {
    blocks: [b],
    history: [
      {
        id: "e1",
        blockId: b.id,
        intent: "tighten",
        status: "accepted",
        beforeText: "The quick brown fox jumps over the lazy dog.",
        afterText: "The fast brown fox leaps over the sleepy dog.",
        createdAt: 2,
      },
    ],
    redoStack: [],
  };
}

async function readDocumentXml(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("missing word/document.xml");
  return file.async("string");
}

describe("exportDocx", () => {
  it("tracked mode (default) emits <w:ins> and <w:del> markup", async () => {
    const bytes = await exportDocx(docWithEdit(), "Test");
    const xml = await readDocumentXml(bytes);
    expect(xml).toMatch(/<w:ins\s/);
    expect(xml).toMatch(/<w:del\s/);
    expect(xml).toContain('w:author="AI Editor"');
    // Word-level diff runs may split shared substrings across multiple
    // runs (e.g. jumps→leaps overlaps "ps"). Just verify the inserted
    // chunks include text from the new revision.
    expect(xml).toMatch(/<w:t[^>]*>fast<\/w:t>/);
  });

  it("clean mode emits zero <w:ins> / <w:del> markup", async () => {
    const bytes = await exportDocx(docWithEdit(), "Test", { mode: "clean" });
    const xml = await readDocumentXml(bytes);
    expect(xml).not.toMatch(/<w:ins\s/);
    expect(xml).not.toMatch(/<w:del\s/);
    expect(xml).not.toContain('w:author="AI Editor"');
  });

  it("clean mode contains the latest accepted text intact", async () => {
    const bytes = await exportDocx(docWithEdit(), "Test", { mode: "clean" });
    const xml = await readDocumentXml(bytes);
    // The full final-text string is contiguous in the clean output
    expect(xml).toContain("The fast brown fox leaps over the sleepy dog.");
    // The pre-edit text should NOT appear at all
    expect(xml).not.toContain("quick brown");
    expect(xml).not.toContain("lazy dog");
  });

  it("clean mode header reads 'Final copy' instead of 'AI-edited'", async () => {
    const bytes = await exportDocx(docWithEdit(), "Test", { mode: "clean" });
    const xml = await readDocumentXml(bytes);
    expect(xml).toContain("Final copy");
    expect(xml).not.toContain("AI-edited");
  });

  it("both modes produce valid DOCX zip with word/document.xml", async () => {
    const tracked = await exportDocx(docWithEdit(), "T");
    const clean = await exportDocx(docWithEdit(), "T", { mode: "clean" });
    // Both start with PK\x03\x04 zip magic
    expect(tracked.slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
    expect(clean.slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
    // Both can be unzipped
    await readDocumentXml(tracked);
    await readDocumentXml(clean);
  });
});
