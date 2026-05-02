"use client";

import { computeDiff } from "@/lib/diff";
import { currentText, type Block, type DocumentModel } from "@/lib/doc-model";
import { cn } from "@/lib/utils";

interface DocPreviewProps {
  doc: DocumentModel;
  className?: string;
  /**
   * When true (default), edited blocks render with inline track-changes
   * (red strikethrough + green underline). When false, the preview shows
   * only the final/current text — useful for "what would the export look
   * like" previews.
   */
  showChanges?: boolean;
}

/**
 * V1.7: live HTML preview of the edited doc.
 *
 * Renders the doc-model as styled HTML with optional inline track-changes
 * markers. Replaces the V1.6 "Edited PDF" toggle — instead of trying to
 * cover-and-replace text in the original PDF (which was fragile and
 * gimmicky), we render the doc cleanly in the browser with proper diffs.
 *
 * Print-to-PDF from this view (browser native) gives the user a clean PDF
 * for free. Block kinds map to standard HTML: heading → h2, paragraph →
 * p, list_item → li (grouped into ul), caption → italic small text.
 */
export function DocPreview({
  doc,
  className,
  showChanges = true,
}: DocPreviewProps) {
  // Group consecutive list_items so they render under a single <ul>.
  const groups = groupBlocks(doc.blocks);

  return (
    <article
      className={cn(
        "doc-preview prose prose-sm dark:prose-invert mx-auto max-w-3xl px-8 py-10",
        className,
      )}
    >
      {groups.map((group, gi) => {
        if (group.kind === "list") {
          return (
            <ul key={gi} className="my-3 list-disc space-y-1 pl-6">
              {group.blocks.map((b) => (
                <li
                  key={b.id}
                  data-block-id={b.id}
                  data-block-kind={b.kind}
                  className="leading-relaxed"
                >
                  {renderBlockContent(b, showChanges)}
                </li>
              ))}
            </ul>
          );
        }
        return group.blocks.map((b) => (
          <BlockElement
            key={b.id}
            block={b}
            showChanges={showChanges}
          />
        ));
      })}
    </article>
  );
}

interface BlockElementProps {
  block: Block;
  showChanges: boolean;
}

function BlockElement({ block, showChanges }: BlockElementProps) {
  const text = currentText(block);
  if (!text.trim() && block.kind !== "figure") return null;

  switch (block.kind) {
    case "cover":
      return (
        <h1
          data-block-id={block.id}
          data-block-kind={block.kind}
          className="mb-4 text-center text-3xl font-bold tracking-tight"
        >
          {renderBlockContent(block, showChanges)}
        </h1>
      );
    case "heading":
      return (
        <h2
          data-block-id={block.id}
          data-block-kind={block.kind}
          className="mt-6 mb-2 text-xl font-semibold"
        >
          {renderBlockContent(block, showChanges)}
        </h2>
      );
    case "caption":
      return (
        <p
          data-block-id={block.id}
          data-block-kind={block.kind}
          className="text-muted-foreground my-2 text-xs italic"
        >
          {renderBlockContent(block, showChanges)}
        </p>
      );
    case "table":
      return (
        <div
          data-block-id={block.id}
          data-block-kind={block.kind}
          className="border-border my-3 rounded-md border bg-muted/30 px-3 py-2 text-xs"
        >
          {renderBlockContent(block, showChanges)}
        </div>
      );
    case "figure":
    case "header_footer":
      // Skipped in preview — they're decorative or not extractable.
      return null;
    default:
      return (
        <p
          data-block-id={block.id}
          data-block-kind={block.kind}
          className="my-3 leading-relaxed"
        >
          {renderBlockContent(block, showChanges)}
        </p>
      );
  }
}

/**
 * For edited blocks (revisions.length > 1), diffs the original revision
 * against the current text and emits a sequence of inline spans:
 *   - equal segments → plain
 *   - inserted segments → green underline
 *   - deleted segments → red strikethrough
 * For unedited blocks, just plain text.
 */
function renderBlockContent(block: Block, showChanges: boolean) {
  const text = currentText(block);
  if (!showChanges || block.revisions.length <= 1) {
    return text;
  }
  const original = block.revisions[0]?.text ?? "";
  const ops = computeDiff(original, text);
  return ops.map((op, i) => {
    if (op.kind === "equal") {
      return <span key={i}>{op.text}</span>;
    }
    if (op.kind === "insert") {
      return (
        <span
          key={i}
          className="bg-emerald-100 text-emerald-900 underline decoration-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          {op.text}
        </span>
      );
    }
    return (
      <span
        key={i}
        className="bg-rose-100 text-rose-900/80 line-through decoration-rose-500 dark:bg-rose-950/40 dark:text-rose-200"
      >
        {op.text}
      </span>
    );
  });
}

interface BlockGroup {
  kind: "list" | "other";
  blocks: Block[];
}

function groupBlocks(blocks: Block[]): BlockGroup[] {
  const groups: BlockGroup[] = [];
  for (const block of blocks) {
    const last = groups[groups.length - 1];
    if (block.kind === "list_item") {
      if (last && last.kind === "list") {
        last.blocks.push(block);
      } else {
        groups.push({ kind: "list", blocks: [block] });
      }
    } else {
      if (last && last.kind === "other") {
        last.blocks.push(block);
      } else {
        groups.push({ kind: "other", blocks: [block] });
      }
    }
  }
  return groups;
}
