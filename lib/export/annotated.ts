/**
 * Annotated original PDF exporter.
 *
 * Loads the original PDF binary as-is, draws numbered colored markers at
 * each accepted edit's resolved bbox (skipping any with confidence <0.6),
 * and appends a Changes Summary page enumerating every edit with
 * before/after text.
 *
 * Design choice: we OVERLAY on the original — we never modify text content
 * streams. That tar-pit is documented in the README cuts list. Our marker
 * + summary approach is the DocuSign/HelloSign pattern: 95% of user value,
 * zero silent-failure modes.
 *
 * Bbox accuracy gate: if <80% of edits land within ±20pt of the expected
 * bbox on the Dixon SOQ (measured at M10), we ship Markdown as the default
 * export and demote Annotated to "experimental" in the popover.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import type { Block, DocumentModel, EditHistoryItem } from "../doc-model";
import { pdfJsBboxToPdfLibRect } from "../pdf-coords";
import { winAnsiSafe } from "./winansi-safe";

const MARKER_RADIUS = 12;
const MARKER_COLOR = rgb(0.92, 0.45, 0.18); // warm orange, contrasts on white + most brand palettes

const SUMMARY_FONT_BODY = StandardFonts.Helvetica;
const SUMMARY_FONT_BOLD = StandardFonts.HelveticaBold;
const SUMMARY_FONT_ITALIC = StandardFonts.HelveticaOblique;

const SUMMARY_PAGE_WIDTH = 612;
const SUMMARY_PAGE_HEIGHT = 792;
const SUMMARY_MARGIN_X = 60;
const SUMMARY_MARGIN_Y = 60;

export interface AnnotatedExportInput {
  originalPdfBytes: ArrayBuffer | Uint8Array;
  doc: DocumentModel;
  title: string;
}

interface RenderableEdit {
  number: number;
  entry: EditHistoryItem;
  block: Block;
}

export async function exportAnnotatedPdf(
  input: AnnotatedExportInput,
): Promise<Uint8Array> {
  const { originalPdfBytes, doc, title } = input;

  const pdf = await PDFDocument.load(originalPdfBytes);
  pdf.setProducer("AI Proposal Editor");
  pdf.setTitle(`${title} — Annotated`);

  const helvetica = await pdf.embedFont(StandardFonts.HelveticaBold);
  const helveticaBody = await pdf.embedFont(SUMMARY_FONT_BODY);
  const helveticaBold = await pdf.embedFont(SUMMARY_FONT_BOLD);
  const helveticaItalic = await pdf.embedFont(SUMMARY_FONT_ITALIC);

  const renderable: RenderableEdit[] = [];
  let nextNumber = 1;

  for (const entry of doc.history) {
    if (entry.status !== "accepted") continue;
    const block = doc.blocks.find((b) => b.id === entry.blockId);
    if (!block) continue;
    renderable.push({ number: nextNumber++, entry, block });
  }

  // Draw markers on original pages where bbox was resolved with sufficient confidence.
  const pages = pdf.getPages();
  for (const item of renderable) {
    const resolved = item.block.bboxResolved;
    if (!resolved) continue;
    if (resolved.confidence < 0.6) continue;
    const page = pages[resolved.page - 1];
    if (!page) continue;

    const rect = pdfJsBboxToPdfLibRect(
      {
        page: resolved.page,
        x: resolved.x,
        y: resolved.y,
        w: resolved.w,
        h: resolved.h,
      },
      page.getHeight(),
    );

    // Draw the circle in the LEFT margin near the block — not over the text.
    // marker x = left margin offset, y = vertical center of the block.
    const markerX = Math.max(28, rect.x - 28);
    const markerY = rect.y + rect.height / 2;

    page.drawCircle({
      x: markerX,
      y: markerY,
      size: MARKER_RADIUS,
      color: MARKER_COLOR,
      opacity: 0.95,
    });
    const numStr = String(item.number);
    const numWidth = helvetica.widthOfTextAtSize(numStr, 11);
    page.drawText(numStr, {
      x: markerX - numWidth / 2,
      y: markerY - 4,
      size: 11,
      font: helvetica,
      color: rgb(1, 1, 1),
    });
  }

  // Append summary page(s).
  let summaryPage = pdf.addPage([SUMMARY_PAGE_WIDTH, SUMMARY_PAGE_HEIGHT]);
  let cursorY = SUMMARY_PAGE_HEIGHT - SUMMARY_MARGIN_Y;

  const newSummaryPage = (): void => {
    summaryPage = pdf.addPage([SUMMARY_PAGE_WIDTH, SUMMARY_PAGE_HEIGHT]);
    cursorY = SUMMARY_PAGE_HEIGHT - SUMMARY_MARGIN_Y;
  };

  const ensureSpace = (needed: number) => {
    if (cursorY - needed < SUMMARY_MARGIN_Y) newSummaryPage();
  };

  const drawHeader = () => {
    summaryPage.drawText(winAnsiSafe(`${title} — Changes Summary`), {
      x: SUMMARY_MARGIN_X,
      y: cursorY - 18,
      size: 18,
      font: helveticaBold,
    });
    cursorY -= 30;
    summaryPage.drawText(
      `${renderable.length} change${renderable.length === 1 ? "" : "s"} ` +
        `· generated ${new Date().toLocaleDateString()}`,
      {
        x: SUMMARY_MARGIN_X,
        y: cursorY - 12,
        size: 10,
        font: helveticaItalic,
        color: rgb(0.45, 0.45, 0.45),
      },
    );
    cursorY -= 30;
  };

  drawHeader();

  for (const item of renderable) {
    const headerHeight = 30;
    // Sanitize before measuring or drawing — `widthOfTextAtSize` itself
    // crashes on un-encodable characters, so wrap() must see WinAnsi-safe
    // text.
    const beforeText = winAnsiSafe(item.entry.beforeText);
    const afterText = winAnsiSafe(item.entry.afterText);
    const beforeLines = wrap(beforeText, helveticaBody, 10, SUMMARY_PAGE_WIDTH - 2 * SUMMARY_MARGIN_X);
    const afterLines = wrap(afterText, helveticaBody, 10, SUMMARY_PAGE_WIDTH - 2 * SUMMARY_MARGIN_X);
    const totalHeight =
      headerHeight + (beforeLines.length + afterLines.length) * 14 + 24;
    ensureSpace(totalHeight);

    // Marker badge + intent label.
    summaryPage.drawCircle({
      x: SUMMARY_MARGIN_X + 9,
      y: cursorY - 9,
      size: 9,
      color: MARKER_COLOR,
    });
    summaryPage.drawText(String(item.number), {
      x: SUMMARY_MARGIN_X + 9 - helveticaBold.widthOfTextAtSize(String(item.number), 9) / 2,
      y: cursorY - 12,
      size: 9,
      font: helveticaBold,
      color: rgb(1, 1, 1),
    });
    summaryPage.drawText(
      winAnsiSafe(`Page ${item.block.page} · ${prettifyIntent(item.entry.intent)}`),
      {
        x: SUMMARY_MARGIN_X + 28,
        y: cursorY - 12,
        size: 10,
        font: helveticaBold,
      },
    );
    if (item.entry.userPrompt) {
      summaryPage.drawText(winAnsiSafe(`"${truncate(item.entry.userPrompt, 60)}"`), {
        x: SUMMARY_MARGIN_X + 28,
        y: cursorY - 24,
        size: 9,
        font: helveticaItalic,
        color: rgb(0.45, 0.45, 0.45),
      });
      cursorY -= 36;
    } else {
      cursorY -= 22;
    }

    // Before block.
    summaryPage.drawText("Original:", {
      x: SUMMARY_MARGIN_X + 28,
      y: cursorY - 11,
      size: 9,
      font: helveticaItalic,
      color: rgb(0.5, 0.2, 0.2),
    });
    cursorY -= 14;
    for (const line of beforeLines) {
      ensureSpace(14);
      summaryPage.drawText(line, {
        x: SUMMARY_MARGIN_X + 28,
        y: cursorY - 10,
        size: 10,
        font: helveticaBody,
        color: rgb(0.3, 0.3, 0.3),
      });
      cursorY -= 12;
    }

    cursorY -= 4;

    // After block.
    summaryPage.drawText("Edited:", {
      x: SUMMARY_MARGIN_X + 28,
      y: cursorY - 11,
      size: 9,
      font: helveticaItalic,
      color: rgb(0.2, 0.5, 0.2),
    });
    cursorY -= 14;
    for (const line of afterLines) {
      ensureSpace(14);
      summaryPage.drawText(line, {
        x: SUMMARY_MARGIN_X + 28,
        y: cursorY - 10,
        size: 10,
        font: helveticaBody,
      });
      cursorY -= 12;
    }
    cursorY -= 18;
  }

  return pdf.save();
}

function wrap(
  text: string,
  font: import("pdf-lib").PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n+/)) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function prettifyIntent(intent: EditHistoryItem["intent"]): string {
  switch (intent) {
    case "tighten":
      return "Tightened";
    case "match_voice":
      return "Matched firm voice";
    case "fix_names":
      return "Fixed names";
    case "reference_past_work":
      return "Referenced past work";
    case "freeform":
      return "Free-form edit";
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
