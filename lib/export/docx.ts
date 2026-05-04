/**
 * DOCX export — supports two output modes:
 *
 *   - "tracked" (default): every accepted edit is encoded as a Word
 *     `<w:ins>` / `<w:del>` revision pair via the `docx` package's
 *     `InsertedTextRun` / `DeletedTextRun`. The file opens in Word with
 *     redline markup and the Review pane lets reviewers accept/reject
 *     each change. This is the headline format for proposal-review
 *     workflows where legal/sales sign off in Word.
 *
 *   - "clean": just renders the current text of every block as plain
 *     `TextRun`s. No `<w:ins>` / `<w:del>` markup, no redline. Use this
 *     when you want a polished final copy to send a client without any
 *     visible edit history. Equivalent to "Accept All Changes" in Word.
 *
 * For unedited blocks both modes emit plain `TextRun`s. For edited
 * blocks, "tracked" mode runs the diff and emits insert/delete pairs;
 * "clean" mode emits only the current text.
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

const AUTHOR = "AI Editor";

export type DocxExportMode = "tracked" | "clean";

export interface DocxExportOptions {
  /**
   * "tracked" (default) emits Word track-changes markup so reviewers can
   * accept/reject each edit in Word's Review pane. "clean" emits only the
   * current accepted text — equivalent to a final copy with all changes
   * accepted, no visible edit history.
   */
  mode?: DocxExportMode;
}

export async function exportDocx(
  doc: DocumentModel,
  title: string,
  options: DocxExportOptions = {},
): Promise<Uint8Array> {
  const mode: DocxExportMode = options.mode ?? "tracked";
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
          text:
            mode === "clean"
              ? `Final copy — ${new Date().toLocaleDateString()}`
              : `AI-edited — ${new Date().toLocaleDateString()}`,
          italics: true,
          size: 18,
          color: "666666",
        }),
      ],
    }),
  );

  // Track-change ids must be unique across the document. Only used in
  // "tracked" mode but declared here for scope.
  let revisionId = 1;
  const lastEditByBlock = mapLastEditTime(doc);

  for (const block of doc.blocks) {
    if (block.kind === "figure" || block.kind === "header_footer") continue;

    const text = currentText(block);
    if (!text.trim()) continue;

    // In "clean" mode every block — edited or not — emits a single plain
    // TextRun with the current text. No track-change markup at all.
    const hasEdit = mode === "tracked" && block.revisions.length > 1;
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
    creator: "AI Proposal Editor",
    title,
    description: "AI-edited proposal. Word track-changes enabled.",
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
