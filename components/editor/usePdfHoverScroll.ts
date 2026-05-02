"use client";

import { useEffect, useRef } from "react";

import { runProgrammaticScroll } from "@/lib/scroll-mutex";
import { useSessionStore } from "@/lib/session-store";

/**
 * When the user hovers a block on the right pane, scroll the PDF pane to
 * that block's page on the left. Debounced so it doesn't thrash on rapid
 * mouse movement.
 *
 * The hook is mounted inside PdfPane and operates on its own scroll
 * container.
 *
 * V1.5: scroll command goes through `runProgrammaticScroll` so the shared
 * scroll-mutex prevents this hook from fighting `usePaneScrollSync`. Without
 * the mutex, hover-scroll → triggers IO in DocPane → triggers sync-scroll
 * back → ping-pong.
 */
export function usePdfHoverScroll(
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const hoveredBlockId = useSessionStore((s) => s.hoveredBlockId);
  const doc = useSessionStore((s) => s.doc);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!hoveredBlockId || !doc || !containerRef.current) return;

    const block = doc.blocks.find((b) => b.id === hoveredBlockId);
    if (!block) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;
      const pageEl = container.querySelector(
        `[data-page-num="${block.page}"]`,
      );
      if (pageEl instanceof HTMLElement) {
        // Custom smooth scroll using offsetTop (not scrollIntoView, which
        // would also scroll the document body).
        const targetTop =
          pageEl.offsetTop -
          container.offsetTop -
          24; /* small top breathing room */
        runProgrammaticScroll("hover", container, targetTop);
      }
    }, 120);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [hoveredBlockId, doc, containerRef]);
}
