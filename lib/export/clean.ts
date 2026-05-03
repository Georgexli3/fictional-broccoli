/**
 * Clean PDF exporter — generates a fresh PDF from the doc model using
 * pdf-lib.
 *
 * Trade-off explicit in README: this preserves CONTENT but not BRAND. We
 * lose the original fonts, logos, multi-column layouts, and tables-as-grids;
 * we gain accuracy on the user's edited text. The annotated-original export
 * is the format that preserves branding (M10).
 *
 * We use pdf-lib's standard fonts (Times-Roman, Helvetica) and a simple
 * top-down text layout with manual line wrapping. No native bindings, runs
 * in serverless functions without canvas/sharp.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { currentText, type DocumentModel } from "../doc-model";
import { winAnsiSafe } from "./winansi-safe";

const PAGE_WIDTH = 612; // US Letter
const PAGE_HEIGHT = 792;
const MARGIN_X = 60;
const MARGIN_Y = 60;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN_X;

const FONT_BODY_SIZE = 11;
const FONT_HEADING_SIZE = 14;
const FONT_COVER_SIZE = 22;
const LINE_HEIGHT_BODY = FONT_BODY_SIZE * 1.4;
const LINE_HEIGHT_HEADING = FONT_HEADING_SIZE * 1.3;

export async function exportCleanPdf(
  doc: DocumentModel,
  title: string,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setProducer("AI Proposal Editor");

  const fontBody = await pdf.embedFont(StandardFonts.TimesRoman);
  const fontBodyItalic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const fontHeading = await pdf.embedFont(StandardFonts.HelveticaBold);

  const ctx = createCursor(pdf, fontBody);

  // Cover line.
  if (title) {
    drawText(ctx, title, fontHeading, FONT_COVER_SIZE, { color: rgb(0, 0, 0) });
    advance(ctx, FONT_COVER_SIZE * 1.5);
    drawText(
      ctx,
      `AI-edited — ${new Date().toLocaleDateString()}`,
      fontBodyItalic,
      9,
      { color: rgb(0.4, 0.4, 0.4) },
    );
    advance(ctx, 24);
  }

  for (const block of doc.blocks) {
    const text = currentText(block).trim();
    if (!text) continue;

    switch (block.kind) {
      case "cover":
        drawWrapped(ctx, text, fontHeading, FONT_HEADING_SIZE);
        advance(ctx, 8);
        break;
      case "heading":
        ensureSpace(ctx, FONT_HEADING_SIZE * 2);
        advance(ctx, 8);
        drawWrapped(ctx, text, fontHeading, FONT_HEADING_SIZE, {
          lineHeight: LINE_HEIGHT_HEADING,
        });
        advance(ctx, 4);
        break;
      case "paragraph":
        drawWrapped(ctx, text, fontBody, FONT_BODY_SIZE);
        advance(ctx, 6);
        break;
      case "list_item":
        drawWrapped(ctx, `• ${text}`, fontBody, FONT_BODY_SIZE, { indent: 12 });
        advance(ctx, 2);
        break;
      case "caption":
        drawWrapped(ctx, text, fontBodyItalic, FONT_BODY_SIZE - 1, {
          color: rgb(0.4, 0.4, 0.4),
        });
        advance(ctx, 6);
        break;
      case "table":
        drawWrapped(ctx, text, fontBody, FONT_BODY_SIZE - 1, {
          color: rgb(0.2, 0.2, 0.2),
        });
        advance(ctx, 6);
        break;
      // figure + header_footer skipped.
      default:
        break;
    }
  }

  drawPageNumbers(pdf, fontBody);

  return pdf.save();
}

interface Cursor {
  pdf: PDFDocument;
  page: ReturnType<PDFDocument["addPage"]>;
  y: number;
  defaultFont: import("pdf-lib").PDFFont;
}

function createCursor(
  pdf: PDFDocument,
  defaultFont: import("pdf-lib").PDFFont,
): Cursor {
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  return { pdf, page, y: PAGE_HEIGHT - MARGIN_Y, defaultFont };
}

function ensureSpace(ctx: Cursor, neededFromTop: number) {
  if (ctx.y - neededFromTop < MARGIN_Y) {
    ctx.page = ctx.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    ctx.y = PAGE_HEIGHT - MARGIN_Y;
  }
}

function advance(ctx: Cursor, dy: number) {
  ctx.y -= dy;
  if (ctx.y < MARGIN_Y) {
    ctx.page = ctx.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    ctx.y = PAGE_HEIGHT - MARGIN_Y;
  }
}

interface DrawOpts {
  color?: ReturnType<typeof rgb>;
  indent?: number;
  lineHeight?: number;
}

function drawText(
  ctx: Cursor,
  text: string,
  font: import("pdf-lib").PDFFont,
  size: number,
  opts: DrawOpts = {},
) {
  ensureSpace(ctx, size + 4);
  ctx.page.drawText(winAnsiSafe(text), {
    x: MARGIN_X + (opts.indent ?? 0),
    y: ctx.y - size,
    size,
    font,
    color: opts.color ?? rgb(0, 0, 0),
  });
}

function drawWrapped(
  ctx: Cursor,
  text: string,
  font: import("pdf-lib").PDFFont,
  size: number,
  opts: DrawOpts = {},
) {
  const indent = opts.indent ?? 0;
  const lineHeight = opts.lineHeight ?? size * 1.4;
  const maxWidth = CONTENT_WIDTH - indent;

  // Sanitize at the wrap boundary — `font.widthOfTextAtSize` itself calls
  // into the WinAnsi encoder and throws on un-encodable characters, so we
  // can't wait until drawText.
  const safeText = winAnsiSafe(text);
  // Manual word-wrap. pdf-lib doesn't ship layout.
  const paragraphs = safeText.split(/\n+/);
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      const width = font.widthOfTextAtSize(candidate, size);
      if (width > maxWidth && line) {
        drawText(ctx, line, font, size, { ...opts, indent });
        advance(ctx, lineHeight);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      drawText(ctx, line, font, size, { ...opts, indent });
      advance(ctx, lineHeight);
    }
  }
}

function drawPageNumbers(
  pdf: PDFDocument,
  font: import("pdf-lib").PDFFont,
) {
  const pages = pdf.getPages();
  pages.forEach((page, i) => {
    const text = `${i + 1} / ${pages.length}`;
    const width = font.widthOfTextAtSize(text, 9);
    page.drawText(text, {
      x: PAGE_WIDTH - MARGIN_X - width,
      y: 30,
      size: 9,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
  });
}
