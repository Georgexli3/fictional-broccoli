/**
 * Parse-time prompt + tool definition.
 *
 * The model is asked to emit a single tool call: `emit_document_structure`
 * with a strict schema. We use `tool_choice: { type: "tool", name: "..." }`
 * to force structured output — no free-form prose, no hedging.
 *
 * Why this prompt shape:
 *   - We tell the model what each `kind` means in a sentence so it doesn't
 *     guess wildly on edge cases (TOC items, sidebars, callouts).
 *   - We tell it to preserve text *as written* — no normalization, no
 *     paraphrasing — so `bbox-resolver` can find the same text in the
 *     PDF.js text layer later.
 *   - We tell it to skip purely decorative / brand-mark content as
 *     `header_footer` so users aren't tempted to AI-edit a logo.
 */

import type Anthropic from "@anthropic-ai/sdk";

export const PARSE_SYSTEM_PROMPT = `You are a document-structure extractor for civil-engineering proposals.

Your job is to read the attached PDF and emit a structured representation of every meaningful content block, in reading order.

Definitions:
- "cover": title-page text (project name, client, date, firm name on page 1).
- "heading": section or subsection titles (Project Approach, Project Team, etc.).
- "paragraph": flowing prose of any length.
- "list_item": one line of a bulleted/numbered list.
- "table": one table cell or one logical table row, your call. Keep it consistent within a single table.
- "caption": image/figure captions and table captions.
- "figure": image/figure placeholder (use empty text or a brief description).
- "header_footer": page numbers, running headers, decorative brand marks. The user will not edit these.

Hard rules:
- Preserve the original text exactly as written. Do not paraphrase, normalize whitespace, fix typos, or expand abbreviations. Output the bytes the PDF contains.
- Do not invent content not present in the PDF.
- Emit blocks in reading order across the whole document.
- A single proposal section spanning multiple paragraphs becomes multiple "paragraph" blocks, one per paragraph break.
- Page numbers are 1-indexed.
- bboxHint is optional and approximate. Skip it if uncertain — we resolve precise positions from the PDF text layer.`;

export const PARSE_USER_PROMPT = `Parse this proposal PDF into a structured set of blocks. Use the emit_document_structure tool. Preserve original text exactly.`;

export const emitDocumentStructureTool: Anthropic.Messages.Tool = {
  name: "emit_document_structure",
  description:
    "Emit the full document structure as an ordered list of blocks. Call this exactly once with the complete parse result.",
  input_schema: {
    type: "object",
    properties: {
      blocks: {
        type: "array",
        description: "All content blocks in reading order.",
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: [
                "cover",
                "heading",
                "paragraph",
                "list_item",
                "table",
                "caption",
                "figure",
                "header_footer",
              ],
            },
            page: {
              type: "integer",
              minimum: 1,
              description: "1-indexed page number where this block lives.",
            },
            text: {
              type: "string",
              description: "Exact text of this block, as written in the PDF.",
            },
            bboxHint: {
              type: "object",
              description: "Optional approximate bbox; skip if uncertain.",
              properties: {
                x: { type: "number" },
                y: { type: "number" },
                w: { type: "number" },
                h: { type: "number" },
              },
              required: ["x", "y", "w", "h"],
            },
          },
          required: ["kind", "page", "text"],
        },
      },
    },
    required: ["blocks"],
  },
};
