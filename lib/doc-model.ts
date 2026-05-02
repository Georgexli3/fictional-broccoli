/**
 * Document model — the shape every other module reads/writes.
 *
 * WHY BLOCKS, NOT PARAGRAPHS:
 *   PDFs don't expose paragraphs natively, but they also don't only contain
 *   paragraphs — they contain headings, list items, table rows, captions,
 *   figures, headers, footers. Treating "paragraph" as the only edit unit
 *   would force every other content type into an awkward second-class shape.
 *   Instead, every structural unit is a `Block` with a `kind`. The right pane
 *   renders blocks polymorphically; the edit composer is allowed to operate
 *   on `paragraph | heading | list_item` and refuses on `header_footer |
 *   figure` (locked blocks). This keeps the data model uniform and the UI
 *   honest about what is and isn't editable.
 *
 * WHY REVISIONS-PER-BLOCK, NOT WHOLE-DOC SNAPSHOTS:
 *   A 30-page doc with 200 blocks and 50 edits would mean 50 full clones
 *   under a snapshot model — wasteful in localStorage and noisy when
 *   reasoning about undo. Per-block revision stacks are O(edits-per-block)
 *   in size and let us implement non-linear revert (revert this one edit
 *   while keeping the four edits I made afterward) cleanly.
 *
 * WHY STABLE BLOCK IDS:
 *   Edit history references blockId. If parsing assigns positional IDs
 *   ("page-3-paragraph-2") they break the moment a block is split or merged
 *   during a Reparse. Nanoid IDs assigned at parse time and persisted with
 *   the doc model survive Reparse via best-effort text matching (V2).
 *
 * WHY EDIT HISTORY IS FLAT, NOT TREE:
 *   Linear undo + non-linear revert covers every flow we need. A full edit
 *   tree (branching alternate timelines) is a V2 feature for serious
 *   editorial workflows.
 */

export type BlockKind =
  | "cover"
  | "heading"
  | "paragraph"
  | "list_item"
  | "table"
  | "caption"
  | "figure"
  | "header_footer";

export interface BboxHint {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ResolvedBbox {
  page: number;
  x: number; // PDF.js text-layer pixel coords
  y: number;
  w: number;
  h: number;
  confidence: number; // 0..1; <0.6 means we don't draw annotation markers
}

export interface Revision {
  text: string;
  source: "original" | "edit";
  editId?: string;
  createdAt: number;
}

export interface Block {
  id: string;
  kind: BlockKind;
  page: number;
  order: number;
  bboxHint?: BboxHint;
  bboxResolved?: ResolvedBbox;
  revisions: Revision[];
  editable: boolean;
}

export type EditIntent =
  | "tighten"
  | "match_voice"
  | "fix_names"
  | "reference_past_work"
  | "freeform";

export interface EditHistoryItem {
  id: string;
  blockId: string;
  intent: EditIntent;
  userPrompt?: string; // present when intent === "freeform"
  status: "accepted" | "discarded";
  beforeText: string;
  afterText: string;
  createdAt: number;
}

export interface DocumentModel {
  blocks: Block[];
  history: EditHistoryItem[];
  redoStack: EditHistoryItem[];
}

/**
 * Returns the current displayed text for a block: the most-recent revision
 * regardless of source.
 */
export function currentText(block: Block): string {
  return block.revisions[block.revisions.length - 1]?.text ?? "";
}

/**
 * Returns the original (parsed) text for a block. Used for diffs against the
 * unedited source.
 */
export function originalText(block: Block): string {
  return block.revisions.find((r) => r.source === "original")?.text ?? "";
}

/**
 * Helper: is this block editable in the UI? Locked kinds are always read-only.
 */
export const EDITABLE_KINDS: ReadonlySet<BlockKind> = new Set([
  "cover",
  "heading",
  "paragraph",
  "list_item",
  "caption",
]);

export function isEditableKind(kind: BlockKind): boolean {
  return EDITABLE_KINDS.has(kind);
}
