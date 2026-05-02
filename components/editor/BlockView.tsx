"use client";

import { Lock } from "lucide-react";
import { useCallback } from "react";

import { useSessionStore } from "@/lib/session-store";
import type { Block } from "@/lib/doc-model";
import { cn } from "@/lib/utils";

import { EditComposer } from "./EditComposer";

interface BlockViewProps {
  block: Block;
  text: string;
  contextBefore?: string;
  contextAfter?: string;
}

/**
 * Capture any user text selection that's currently inside the given block
 * element. Used for span-prefill: drag-select "Alejandra Ricci" inside a
 * block, click → composer textarea pre-fills with `Replace 'Alejandra Ricci'
 * with `.
 */
function captureSelectionInside(
  blockEl: HTMLElement | null,
): string | null {
  if (!blockEl) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const text = sel.toString().trim();
  if (!text || text.length < 2 || text.length > 200) return null;
  const range = sel.getRangeAt(0);
  // Both anchor + focus must be inside the block to count.
  if (
    !blockEl.contains(range.startContainer) ||
    !blockEl.contains(range.endContainer)
  ) {
    return null;
  }
  return text;
}

/**
 * One block in the right pane.
 *
 * Click → select; selected blocks expand the inline EditComposer beneath.
 * Locked kinds (header_footer, figure) are visibly read-only and not
 * clickable.
 */
export function BlockView({
  block,
  text,
  contextBefore,
  contextAfter,
}: BlockViewProps) {
  const selectedBlockId = useSessionStore((s) => s.selectedBlockId);
  const selectBlock = useSessionStore((s) => s.selectBlock);
  const setHoveredBlock = useSessionStore((s) => s.setHoveredBlock);

  const isLocked = !block.editable;
  const selected = selectedBlockId === block.id;

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isLocked) return;
      if (selected) return;
      if (
        e.target instanceof HTMLElement &&
        e.target.closest("[data-no-select]")
      )
        return;
      const span = captureSelectionInside(e.currentTarget);
      selectBlock(block.id, span);
    },
    [block.id, isLocked, selectBlock, selected],
  );

  return (
    <div
      data-block-id={block.id}
      data-block-kind={block.kind}
      data-block-page={block.page}
      onMouseEnter={() => !isLocked && setHoveredBlock(block.id)}
      onMouseLeave={() => setHoveredBlock(null)}
      className={cn(
        "rounded-md border px-4 py-3 transition",
        isLocked
          ? "border-transparent bg-transparent opacity-50"
          : "border-transparent hover:border-border hover:bg-muted/40 cursor-pointer",
        selected &&
          "!border-accent !bg-accent/5 cursor-default ring-1 ring-accent/30",
      )}
      onClick={onClick}
    >
      {isLocked && (
        <div className="text-muted-foreground mb-1 flex items-center gap-1 text-xs">
          <Lock className="h-3 w-3" />
          <span className="uppercase tracking-wide">{block.kind}</span>
          <span>· not editable</span>
        </div>
      )}

      <BlockText kind={block.kind} text={text} />

      <div className="text-muted-foreground/60 mt-2 flex items-center gap-2 text-xs">
        <span className="uppercase tracking-wide">{block.kind}</span>
        <span>·</span>
        <span>page {block.page}</span>
        {block.revisions.length > 1 && (
          <>
            <span>·</span>
            <span className="text-accent">edited</span>
          </>
        )}
      </div>

      {selected && !isLocked && (
        <div data-no-select onClick={(e) => e.stopPropagation()}>
          <EditComposer
            block={block}
            contextBefore={contextBefore}
            contextAfter={contextAfter}
          />
        </div>
      )}
    </div>
  );
}

function BlockText({ kind, text }: { kind: Block["kind"]; text: string }) {
  switch (kind) {
    case "cover":
      return (
        <div className="text-foreground text-lg font-semibold leading-snug">
          {text}
        </div>
      );
    case "heading":
      return (
        <div className="text-foreground text-base font-semibold">{text}</div>
      );
    case "list_item":
      return (
        <div className="text-foreground flex gap-2">
          <span className="text-muted-foreground">•</span>
          <span>{text}</span>
        </div>
      );
    case "caption":
      return (
        <div className="text-muted-foreground text-xs italic">{text}</div>
      );
    case "figure":
      return (
        <div className="text-muted-foreground text-xs">
          [figure{text ? `: ${text}` : ""}]
        </div>
      );
    case "header_footer":
      return (
        <div className="text-muted-foreground text-xs">
          {text || "(header/footer)"}
        </div>
      );
    case "table":
      return (
        <div className="text-foreground font-mono text-xs whitespace-pre-wrap">
          {text}
        </div>
      );
    case "paragraph":
    default:
      return (
        <div className="text-foreground leading-relaxed whitespace-pre-wrap">
          {text}
        </div>
      );
  }
}
