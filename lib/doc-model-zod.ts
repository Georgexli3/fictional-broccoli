/**
 * Zod schemas for the document model.
 *
 * The parse pipeline runs untrusted output (LLM JSON) through these schemas
 * at the API boundary. Anything that doesn't validate is rejected with a
 * useful error. This is the primary defense against malformed parse output.
 *
 * The runtime schemas are kept aligned with the TS types in `doc-model.ts` —
 * the `DocumentModel` type is inferred from these schemas where helpful.
 */

import { z } from "zod";

export const blockKindSchema = z.enum([
  "cover",
  "heading",
  "paragraph",
  "list_item",
  "table",
  "caption",
  "figure",
  "header_footer",
]);

export const bboxHintSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite(),
  h: z.number().finite(),
});

/** What the LLM is asked to emit per block. IDs are assigned server-side. */
export const parsedBlockSchema = z.object({
  kind: blockKindSchema,
  page: z.number().int().positive(),
  text: z.string(),
  bboxHint: bboxHintSchema.optional(),
});

export const parsedDocumentSchema = z.object({
  blocks: z.array(parsedBlockSchema),
});

export type ParsedBlock = z.infer<typeof parsedBlockSchema>;
export type ParsedDocument = z.infer<typeof parsedDocumentSchema>;

/** The persistent shape after server-side enrichment (ids, order, revisions). */
export const revisionSchema = z.object({
  text: z.string(),
  source: z.enum(["original", "edit"]),
  editId: z.string().optional(),
  createdAt: z.number(),
});

export const blockSchema = z.object({
  id: z.string(),
  kind: blockKindSchema,
  page: z.number().int().positive(),
  order: z.number().int().nonnegative(),
  bboxHint: bboxHintSchema.optional(),
  bboxResolved: z
    .object({
      page: z.number().int().positive(),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      confidence: z.number().min(0).max(1),
    })
    .optional(),
  revisions: z.array(revisionSchema),
  editable: z.boolean(),
});

export const editIntentSchema = z.enum([
  "tighten",
  "match_voice",
  "fix_names",
  "reference_past_work",
  "freeform",
]);

export const editHistoryItemSchema = z.object({
  id: z.string(),
  blockId: z.string(),
  intent: editIntentSchema,
  userPrompt: z.string().optional(),
  status: z.enum(["accepted", "discarded"]),
  beforeText: z.string(),
  afterText: z.string(),
  createdAt: z.number(),
});

export const documentModelSchema = z.object({
  blocks: z.array(blockSchema),
  history: z.array(editHistoryItemSchema),
  redoStack: z.array(editHistoryItemSchema),
});
