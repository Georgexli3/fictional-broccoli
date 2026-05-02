"use client";

import { History, Pencil, Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";

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

interface ChangesPanelProps {
  className?: string;
}

/**
 * V1.7: always-visible right-edge change list. Replaces V1.6's
 * `ChangesDrawer` — the drawer made the change history feel like a
 * peripheral overlay; in V1.7 it's the primary surface alongside the doc
 * editor (PDF moves to an opt-in toggle in the header).
 *
 * Auto-focus: reads `selectedBlockId ?? activeBlockId` and scrolls the
 * topmost matching entry into view + ring-highlights all entries for that
 * block. Same behavior as the V1.6 drawer once expanded.
 */
export function ChangesPanel({ className }: ChangesPanelProps) {
  const doc = useSessionStore((s) => s.doc);
  const undo = useSessionStore((s) => s.undo);
  const selectBlock = useSessionStore((s) => s.selectBlock);
  const selectedBlockId = useSessionStore((s) => s.selectedBlockId);
  const activeBlockId = useSessionStore((s) => s.activeBlockId);
  const listRef = useRef<HTMLDivElement | null>(null);

  const focusedBlockId = selectedBlockId ?? activeBlockId;
  const accepted = doc?.history.slice().reverse() ?? [];
  const count = accepted.length;

  useEffect(() => {
    if (!focusedBlockId) return;
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-history-block-id="${focusedBlockId}"]`,
    );
    node?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [focusedBlockId]);

  if (!doc) return null;

  return (
    <aside
      className={cn(
        "border-border bg-background flex h-full flex-col border-l",
        className,
      )}
      aria-label="Changes"
    >
      <header className="border-border flex items-center justify-between border-b px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <History className="text-muted-foreground h-3.5 w-3.5" />
          <span className="font-medium">
            {count === 0 ? "No changes yet" : `${count} change${count === 1 ? "" : "s"}`}
          </span>
        </div>
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
                <div className="text-muted-foreground/70 mt-2 text-[10px]">
                  ⌘Z to undo
                </div>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
