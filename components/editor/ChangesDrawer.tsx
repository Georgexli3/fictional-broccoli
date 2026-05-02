"use client";

import { ChevronRight, History, Pencil, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { computeDiff } from "@/lib/diff";
import { useSessionStore } from "@/lib/session-store";
import { cn, formatRelativeTime } from "@/lib/utils";

const INTENT_LABELS: Record<string, string> = {
  tighten: "Tighten",
  match_voice: "Match voice",
  fix_names: "Fix names",
  reference_past_work: "Reference past work",
  freeform: "Free-form",
};

/**
 * V1.6: collapsible right-edge drawer hosting the change list. Replaces the
 * always-visible `ChangesSidebar` from V1 — the drawer keeps the third pane
 * out of the way until the user wants it, freeing horizontal space for the
 * larger PDF + DocPane.
 *
 * Collapsed state: a vertical pill button on the right edge with the change
 * count. Expanded state: 320 px panel sliding in over the DocPane content
 * (overlay — no layout shift in DocPane).
 *
 * Auto-focus: reads `selectedBlockId ?? activeBlockId` from the store and
 * scrolls the matching entry into view + ring-highlights all entries for
 * that block. Doesn't auto-expand — the user opens it deliberately.
 */
export function ChangesDrawer() {
  const doc = useSessionStore((s) => s.doc);
  const undo = useSessionStore((s) => s.undo);
  const selectBlock = useSessionStore((s) => s.selectBlock);
  const selectedBlockId = useSessionStore((s) => s.selectedBlockId);
  const activeBlockId = useSessionStore((s) => s.activeBlockId);
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const focusedBlockId = selectedBlockId ?? activeBlockId;
  const accepted = doc?.history.slice().reverse() ?? [];
  const count = accepted.length;

  // When the focused block changes (and drawer is open), scroll the topmost
  // matching entry into view. Cheaper than IO since the drawer's list is a
  // small DOM tree.
  useEffect(() => {
    if (!open || !focusedBlockId) return;
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-history-block-id="${focusedBlockId}"]`,
    );
    node?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [open, focusedBlockId]);

  if (!doc) return null;

  return (
    <>
      {/* Collapsed pill: visible when the drawer is closed. Anchored to the
          right edge of the DocPane wrapper. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "border-border bg-background hover:bg-muted/40",
            "absolute top-3 right-3 z-20 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm transition",
          )}
          aria-label={`Open changes (${count})`}
        >
          <History className="h-3.5 w-3.5" />
          <span>Changes</span>
          {count > 0 && (
            <span className="bg-accent text-accent-foreground rounded-full px-1.5 py-px text-[10px] font-semibold leading-none">
              {count}
            </span>
          )}
        </button>
      )}

      {/* Expanded panel. Absolute-positioned overlay so the DocPane content
          underneath doesn't reflow. Width transitions smoothly. */}
      <aside
        className={cn(
          "border-border bg-background absolute top-0 right-0 z-20 flex h-full flex-col border-l shadow-xl transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full",
        )}
        style={{ width: 320 }}
        aria-hidden={!open}
      >
        <header className="border-border flex items-center justify-between border-b px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <History className="text-muted-foreground h-3.5 w-3.5" />
            <span className="font-medium">
              {count === 0 ? "No changes yet" : `${count} change${count === 1 ? "" : "s"}`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {count > 0 && (
              <button
                type="button"
                onClick={() => undo()}
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                title="Undo most recent (⌘Z)"
              >
                <Undo2 className="h-3 w-3" />
                Undo
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close changes"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div
          ref={listRef}
          className="flex-1 space-y-2 overflow-auto px-3 py-3 text-xs"
        >
          {count === 0 && (
            <div className="text-muted-foreground/70 py-6 text-center">
              Accepted edits will appear here.
            </div>
          )}

          {accepted.map((entry, i) => {
            const isMostRecent = i === 0;
            const block = doc.blocks.find((b) => b.id === entry.blockId);
            const diff = computeDiff(entry.beforeText, entry.afterText);
            const isFocused = entry.blockId === focusedBlockId;
            return (
              <button
                key={entry.id}
                type="button"
                data-history-block-id={entry.blockId}
                onClick={() => {
                  selectBlock(entry.blockId);
                  const node = document.querySelector(
                    `[data-block-id="${entry.blockId}"]`,
                  );
                  node?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
                className={cn(
                  "border-border hover:bg-muted/50 group block w-full rounded-md border bg-background px-3 py-2 text-left transition",
                  isFocused && "ring-accent/60 bg-accent/5 ring-1",
                )}
              >
                <div className="text-muted-foreground mb-1 flex items-center gap-1">
                  <Pencil className="h-3 w-3" />
                  <span className="font-medium">
                    {INTENT_LABELS[entry.intent] ?? entry.intent}
                  </span>
                  <span className="text-muted-foreground/60">
                    · page {block?.page ?? "?"} · {formatRelativeTime(entry.createdAt)}
                  </span>
                </div>

                <div className="line-clamp-3 text-foreground/90">
                  {diff.map((op, j) => {
                    if (op.kind === "equal") {
                      return (
                        <span key={j} className="text-muted-foreground/70">
                          {op.text}
                        </span>
                      );
                    }
                    if (op.kind === "insert") {
                      return (
                        <span
                          key={j}
                          className="bg-success/15 text-success-foreground rounded-sm decoration-emerald-500"
                        >
                          {op.text}
                        </span>
                      );
                    }
                    return (
                      <span
                        key={j}
                        className="text-muted-foreground/60 line-through decoration-rose-500"
                      >
                        {op.text}
                      </span>
                    );
                  })}
                </div>

                {isMostRecent && (
                  <div className="text-muted-foreground/70 mt-2 flex items-center gap-1 text-[10px]">
                    <ChevronRight className="h-2.5 w-2.5" />
                    <span>⌘Z to undo</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </aside>
    </>
  );
}
