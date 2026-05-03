/**
 * V1.7: DOCX export with NATIVE Word track changes.
 *
 * The killer feature for proposal-review workflows: every accepted edit is
 * encoded as a Word `<w:ins>` / `<w:del>` revision pair (via the `docx`
 * package's `InsertedTextRun` / `DeletedTextRun`). When the user opens the
 * file in Word it renders as proper redline markup with the Review pane
 * showing each change for accept/reject — no extra tooling needed.
 *
 * For unedited blocks we emit plain `TextRun`s. For edited blocks we diff
 * the original revision against the current text and emit a sequence of
 * runs that interleave equal / inserted / deleted segments.
 *
 * Block kinds map to Word styles: cover → TITLE, heading → HEADING_1,
 * list_item → bulleted ListParagraph, caption → italic small text. figure
 * and header_footer are skipped (figures aren't extractable client-side
 * and headers/footers are decorative).
 */

import {
  AlignmentType,
  DeletedTextRun,
  Document,
  HeadingLevel,
  InsertedTextRun,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

import { computeDiff } from "../diff";
import { currentText, type Block, type DocumentModel } from "../doc-model";

const AUTHOR = "Buoyant Editor";

export async function exportDocx(
  doc: DocumentModel,
  title: string,
): Promise<Uint8Array> {
  const paragraphs: Paragraph[] = [];

  // Cover line.
  paragraphs.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({ text: title, bold: true, size: 48 }),
      ],
    }),
  );
  paragraphs.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 480 },
      children: [
        new TextRun({
          text: `Edited with Buoyant — ${new Date().toLocaleDateString()}`,
          italics: true,
          size: 18,
          color: "666666",
        }),
      ],
    }),
  );

  // Track-change ids must be unique across the document.
  let revisionId = 1;
  const lastEditByBlock = mapLastEditTime(doc);

  for (const block of doc.blocks) {
    if (block.kind === "figure" || block.kind === "header_footer") continue;

    const text = currentText(block);
    if (!text.trim()) continue;

    const hasEdit = block.revisions.length > 1;
    const original = hasEdit ? block.revisions[0]?.text ?? "" : text;
    const editDate = lastEditByBlock.get(block.id) ?? new Date();

    // Per-kind run styling — applied at construction so it survives the
    // track-change InsertedTextRun / DeletedTextRun split. Applying it
    // post-hoc in `buildParagraph` would require reading text back out of
    // the runs, which docx@9 doesn't expose reliably.
    const style = runStyleForKind(block.kind);

    let children: Array<TextRun | InsertedTextRun | DeletedTextRun>;
    if (hasEdit) {
      const ops = computeDiff(original, text);
      children = ops.map((op) => {
        if (op.kind === "equal") {
          return new TextRun({ text: op.text, ...style });
        }
        if (op.kind === "insert") {
          return new InsertedTextRun({
            text: op.text,
            ...style,
            id: revisionId++,
            author: AUTHOR,
            date: editDate.toISOString(),
          });
        }
        return new DeletedTextRun({
          text: op.text,
          ...style,
          id: revisionId++,
          author: AUTHOR,
          date: editDate.toISOString(),
        });
      });
    } else {
      children = [new TextRun({ text, ...style })];
    }

    paragraphs.push(buildParagraph(block, children));
  }

  const docDef = new Document({
    creator: "Buoyant Proposal Editor",
    title,
    description: "Proposal edited with Buoyant. Word track-changes enabled.",
    sections: [{ children: paragraphs }],
  });

  const buffer = await Packer.toBuffer(docDef);
  return new Uint8Array(buffer);
}

function buildParagraph(
  block: Block,
  children: Array<TextRun | InsertedTextRun | DeletedTextRun>,
): Paragraph {
  switch (block.kind) {
    case "cover":
      return new Paragraph({
        heading: HeadingLevel.TITLE,
        spacing: { after: 240 },
        children,
      });
    case "heading":
      return new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 },
        children,
      });
    case "list_item":
      return new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 80 },
        children,
      });
    case "caption":
      // Italic styling already baked into the runs at construction time
      // (see runStyleForKind), so we can pass them through unchanged.
      return new Paragraph({
        spacing: { after: 120 },
        children,
      });
    case "table":
      // Plain paragraph fallback — the parser doesn't preserve table
      // structure, so we emit body-text rows.
      return new Paragraph({
        spacing: { after: 120 },
        children,
      });
    default:
      return new Paragraph({
        spacing: { after: 160 },
        children,
      });
  }
}

/**
 * Per-block-kind run styling. Returned options are spread into every
 * `TextRun` / `InsertedTextRun` / `DeletedTextRun` for the block, so the
 * style survives the diff-driven split into multiple runs (track-changes
 * inserts/deletes need the same italic/size/color as the equal segments).
 */
function runStyleForKind(
  kind: Block["kind"],
): { italics?: boolean; size?: number; color?: string } {
  if (kind === "caption") {
    return { italics: true, size: 20, color: "666666" };
  }
  return {};
}

function mapLastEditTime(doc: DocumentModel): Map<string, Date> {
  const out = new Map<string, Date>();
  for (const entry of doc.history) {
    if (entry.status !== "accepted") continue;
    const existing = out.get(entry.blockId);
    const ts = new Date(entry.createdAt);
    if (!existing || existing < ts) out.set(entry.blockId, ts);
  }
  return out;
}
