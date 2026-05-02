"use client";

import { Pencil, Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";

import { computeDiff } from "@/lib/diff";
import { useSessionStore } from "@/lib/session-store";
import { cn, formatRelativeTime } from "@/lib/utils";

interface ChangesSidebarProps {
  className?: string;
}

const INTENT_LABELS: Record<string, string> = {
  tighten: "Tighten",
  match_voice: "Match voice",
  fix_names: "Fix names",
  reference_past_work: "Reference past work",
  freeform: "Free-form",
};

/**
 * Right-edge sidebar listing every accepted edit. Click a row to scroll the
 * block into view in the right pane; click the undo button to revert the
 * most-recent edit.
 *
 * V1: linear undo only — only the latest edit has an enabled revert button,
 * because cascading revert (discard subsequent edits on the same block) adds
 * confirmation UX that doesn't fit V1 scope. Non-linear revert is V2.
 */
export function ChangesSidebar({ className }: ChangesSidebarProps) {
  const doc = useSessionStore((s) => s.doc);
  const undo = useSessionStore((s) => s.undo);
  const selectBlock = useSessionStore((s) => s.selectBlock);
  // V1.5: focus tracking — selectedBlockId (user intent) wins over
  // activeBlockId (viewport reality). When focus changes, scroll the
  // topmost matching entry into view + ring-highlight all matching rows.
  const selectedBlockId = useSessionStore((s) => s.selectedBlockId);
  const activeBlockId = useSessionStore((s) => s.activeBlockId);
  const focusedBlockId = selectedBlockId ?? activeBlockId;
  const scrollListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!focusedBlockId) return;
    const list = scrollListRef.current;
    if (!list) return;
    // The data-history-block-id attribute is set on each entry button below.
    const target = list.querySelector<HTMLElement>(
      `[data-history-block-id="${focusedBlockId}"]`,
    );
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [focusedBlockId]);

  if (!doc) return null;

  const accepted = doc.history.slice().reverse();

  return (
    <aside
      className={cn(
        "border-border bg-background flex h-full w-80 flex-col border-l",
        className,
      )}
    >
      <header className="border-border flex items-center justify-between border-b px-4 py-2 text-xs">
        <span className="text-muted-foreground">
          {accepted.length === 0
            ? "No changes yet"
            : `${accepted.length} change${accepted.length === 1 ? "" : "s"}`}
        </span>
        {accepted.length > 0 && (
          <button
            type="button"
            onClick={() => undo()}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
            title="Undo most recent (⌘Z)"
          >
            <Undo2 className="h-3 w-3" />
            Undo
          </button>
        )}
      </header>

      <div
        ref={scrollListRef}
        className="flex-1 space-y-2 overflow-auto px-3 py-3 text-xs"
      >
        {accepted.length === 0 && (
          <div className="text-muted-foreground/70 py-6 text-center">
            Accepted edits will appear here.
          </div>
        )}

        {accepted.map((entry, i) => {
          const isMostRecent = i === 0;
          const isFocused = entry.blockId === focusedBlockId;
          const block = doc.blocks.find((b) => b.id === entry.blockId);
          const diff = computeDiff(entry.beforeText, entry.afterText);
          return (
            <button
              key={entry.id}
              type="button"
              data-history-block-id={entry.blockId}
              onClick={() => {
                selectBlock(entry.blockId);
                // Scroll the block into view, if visible.
                const node = document.querySelector(
                  `[data-block-id="${entry.blockId}"]`,
                );
                node?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              className={cn(
                "border-border hover:bg-muted/50 group block w-full rounded-md border bg-background px-3 py-2 text-left transition",
                isFocused && "ring-1 ring-accent/60 bg-accent/5",
              )}
            >
              <div className="text-muted-foreground mb-1 flex items-center gap-1">
                <Pencil className="h-3 w-3" />
                <span className="font-medium">
                  {INTENT_LABELS[entry.intent] ?? entry.intent}
                </span>
                <span className="text-muted-foreground/60">
                  · page {block?.page ?? "?"} ·{" "}
                  {formatRelativeTime(entry.createdAt)}
                </span>
              </div>

              <div className="line-clamp-3 text-foreground/90">
                {diff.map((op, j) => {
                  if (op.kind === "equal") {
                    return (
                      <span
                        key={j}
                        className="text-muted-foreground/70"
                      >
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
                  <span>⌘Z to undo</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
