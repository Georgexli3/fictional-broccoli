"use client";

import { useState } from "react";

import { bboxToOverlayStyle } from "@/lib/pdf-coords";
import { useSessionStore, usePdfViewMode } from "@/lib/session-store";

import { EditOverlayTooltip } from "./EditOverlayTooltip";

interface PdfEditOverlayProps {
  pageNum: number;
  scale: number;
}

const MIN_OVERLAY_CONFIDENCE = 0.6;

/**
 * V1.5: amber highlight overlays drawn on top of the PDF for blocks that
 * have accepted edits. Mounted as a child of `PdfPage`'s `relative` wrapper;
 * each overlay is an absolutely-positioned div sized via `bboxToOverlayStyle`.
 *
 * Filters (all must hold):
 *   - `pdfViewMode === "edited"` (toggled in the toolbar)
 *   - block has at least one edit (`revisions.length > 1`)
 *   - block has a high-confidence resolved bbox (`confidence >= 0.6`) — same
 *     gate as the annotated-PDF export. Lower confidence skips overlay so we
 *     don't draw on the wrong region.
 *   - bbox is on this page (`bboxResolved.page === pageNum`)
 *
 * Hover → `EditOverlayTooltip` shows the diff. Click → selects the block on
 * the right pane + scrolls DocPane to it (uses `scrollIntoView` matching the
 * existing ChangesSidebar pattern).
 */
export function PdfEditOverlay({ pageNum, scale }: PdfEditOverlayProps) {
  const mode = usePdfViewMode();
  const doc = useSessionStore((s) => s.doc);
  const selectBlock = useSessionStore((s) => s.selectBlock);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (mode !== "edited" || !doc) return null;

  const editedBlocks = doc.blocks.filter(
    (b) =>
      b.revisions.length > 1 &&
      b.bboxResolved !== undefined &&
      b.bboxResolved.confidence >= MIN_OVERLAY_CONFIDENCE &&
      b.bboxResolved.page === pageNum,
  );

  if (editedBlocks.length === 0) return null;

  return (
    <>
      {editedBlocks.map((block) => {
        const bbox = block.bboxResolved!;
        const style = bboxToOverlayStyle(bbox, scale);
        return (
          <div
            key={block.id}
            data-edit-overlay-block-id={block.id}
            style={style}
            onClick={(e) => {
              e.stopPropagation();
              selectBlock(block.id);
              // Scroll right pane to the block. Matches ChangesSidebar's
              // existing pattern; doesn't go through scroll-mutex because
              // the user-intent click is the leader.
              const node = document.querySelector(
                `[data-block-id="${block.id}"]`,
              );
              node?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
            onMouseEnter={() => setHoveredId(block.id)}
            onMouseLeave={() =>
              setHoveredId((cur) => (cur === block.id ? null : cur))
            }
            className="absolute cursor-pointer rounded-sm bg-amber-300/25 ring-2 ring-amber-400 transition-colors hover:bg-amber-300/40"
            aria-label={`Edit on block ${block.id}`}
          >
            {hoveredId === block.id && <EditOverlayTooltip block={block} />}
          </div>
        );
      })}
    </>
  );
}
