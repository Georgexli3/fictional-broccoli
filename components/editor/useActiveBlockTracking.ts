"use client";

import { useEffect, type RefObject } from "react";

import { isProgrammaticScroll } from "@/lib/scroll-mutex";
import { useSessionStore } from "@/lib/session-store";

/**
 * Tracks which block is currently in the middle band of the DocPane viewport
 * and writes that id to `activeBlockId` in the session store.
 *
 * Pattern D from the V1.5 plan: one IntersectionObserver per pane, all
 * `[data-block-id]` elements observed, `rootMargin: "-40% 0px -40% 0px"` so
 * only blocks crossing the middle 20% of the viewport fire the callback.
 *
 * Locked blocks (`header_footer`, `figure`) are filtered out — they're not
 * editable, so highlighting their (non-existent) edits in the sidebar would
 * be noise.
 *
 * IO callbacks early-return when a programmatic scroll is in flight (mutex
 * from `lib/scroll-mutex.ts`) — otherwise the smooth-scroll triggered by
 * `usePaneScrollSync` or `usePdfHoverScroll` would cascade through this hook
 * and re-trigger the leader, creating a feedback loop.
 *
 * Re-observes whenever the doc changes (block insertions, undo/redo), since
 * BlockView elements get unmounted/remounted as the doc-model updates.
 */
const LOCKED_KINDS = new Set(["header_footer", "figure"]);

export function useActiveBlockTracking(
  scrollContainerRef: RefObject<HTMLDivElement | null>,
): void {
  const doc = useSessionStore((s) => s.doc);
  const setActiveBlockId = useSessionStore((s) => s.setActiveBlockId);

  useEffect(() => {
    if (!doc) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const blockEls = container.querySelectorAll<HTMLElement>("[data-block-id]");
    if (blockEls.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (isProgrammaticScroll()) return;

        const candidates = entries
          .filter((e) => e.isIntersecting)
          .filter((e) => {
            const kind = (e.target as HTMLElement).dataset.blockKind;
            return !kind || !LOCKED_KINDS.has(kind);
          })
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          );

        if (candidates.length === 0) return;
        const winner = candidates[0]!.target as HTMLElement;
        const id = winner.dataset.blockId;
        if (id) setActiveBlockId(id);
      },
      {
        root: container,
        rootMargin: "-40% 0px -40% 0px",
        threshold: 0,
      },
    );

    blockEls.forEach((b) => io.observe(b));

    return () => io.disconnect();
    // Deps note: we use `doc?.blocks.length` (not the full `doc`) because IO
    // only cares about the SET of block elements, not their text contents.
    // Re-running on every accepted edit would be wasteful.
  }, [doc?.blocks.length, scrollContainerRef, setActiveBlockId]);
}
