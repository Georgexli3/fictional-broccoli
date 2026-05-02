"use client";

import { useEffect, useState, type RefObject } from "react";

import { isProgrammaticScroll, runProgrammaticScroll } from "@/lib/scroll-mutex";
import { useSessionStore } from "@/lib/session-store";

const LOCKED_KINDS = new Set(["header_footer", "figure"]);
const PDF_BREATHING_ROOM_PX = 24;
const DOC_BREATHING_ROOM_PX = 16;

type Leader = "pdf" | "doc";

/**
 * Bidirectional scroll-sync between the PDF pane and the DocPane.
 *
 * Pattern A+B+D from the V1.5 plan:
 *   - Pointer-leader detection via mouseenter on each pane (default: PDF).
 *   - Each pane has an IntersectionObserver with a band rootMargin so only
 *     the most-prominently-visible element triggers the callback.
 *   - The leader's IO output drives the follower's scrollTo via
 *     `runProgrammaticScroll` (shared mutex with `usePdfHoverScroll`).
 *
 * The DocPane already has `useActiveBlockTracking` writing `activeBlockId`
 * to the store — we read that here instead of mounting a duplicate IO.
 *
 * Bail conditions: no doc, ref not yet attached. Either short-circuits the
 * effect cleanly without any side-effects.
 */
export function usePaneScrollSync(
  pdfRef: RefObject<HTMLDivElement | null>,
  docRef: RefObject<HTMLDivElement | null>,
): void {
  const doc = useSessionStore((s) => s.doc);
  const activeBlockId = useSessionStore((s) => s.activeBlockId);
  const [leader, setLeader] = useState<Leader>("pdf");
  const [activePdfPage, setActivePdfPage] = useState<number | null>(null);

  // Leader switches on mouseenter of each pane.
  useEffect(() => {
    const pdf = pdfRef.current;
    const docEl = docRef.current;
    if (!pdf || !docEl) return;
    const onPdfEnter = () => setLeader("pdf");
    const onDocEnter = () => setLeader("doc");
    pdf.addEventListener("mouseenter", onPdfEnter);
    docEl.addEventListener("mouseenter", onDocEnter);
    return () => {
      pdf.removeEventListener("mouseenter", onPdfEnter);
      docEl.removeEventListener("mouseenter", onDocEnter);
    };
  }, [pdfRef, docRef]);

  // PDF pane IO: track active page (the DocPane's IO already lives in
  // useActiveBlockTracking and writes `activeBlockId` to the store).
  useEffect(() => {
    if (!doc) return;
    const container = pdfRef.current;
    if (!container) return;
    const pageEls = container.querySelectorAll<HTMLElement>("[data-page-num]");
    if (pageEls.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (isProgrammaticScroll()) return;
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          );
        if (visible.length === 0) return;
        const winner = visible[0]!.target as HTMLElement;
        const pageNum = parseInt(winner.dataset.pageNum ?? "0", 10);
        if (pageNum > 0) setActivePdfPage(pageNum);
      },
      {
        root: container,
        rootMargin: "-40% 0px -40% 0px",
        threshold: 0,
      },
    );
    pageEls.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [doc?.blocks.length, pdfRef]);

  // PDF leader → scroll DocPane to first editable block on active page.
  useEffect(() => {
    if (leader !== "pdf") return;
    if (!doc || activePdfPage == null) return;
    const docEl = docRef.current;
    if (!docEl) return;

    // Walk forward from the active page to find one with an editable block.
    // Some pages are all header_footer / figure — fall through.
    const maxPage = activePdfPage + 5;
    let targetBlockId: string | null = null;
    for (let p = activePdfPage; p <= maxPage; p++) {
      const candidate = doc.blocks.find(
        (b) => b.page === p && !LOCKED_KINDS.has(b.kind),
      );
      if (candidate) {
        targetBlockId = candidate.id;
        break;
      }
    }
    if (!targetBlockId) return;

    const targetEl = docEl.querySelector<HTMLElement>(
      `[data-block-id="${targetBlockId}"]`,
    );
    if (!targetEl) return;
    const targetTop =
      targetEl.offsetTop - docEl.offsetTop - DOC_BREATHING_ROOM_PX;
    runProgrammaticScroll("sync", docEl, targetTop);
  }, [leader, activePdfPage, doc, docRef]);

  // Doc leader → scroll PdfPane to active block's page.
  useEffect(() => {
    if (leader !== "doc") return;
    if (!doc || !activeBlockId) return;
    const pdfEl = pdfRef.current;
    if (!pdfEl) return;
    const block = doc.blocks.find((b) => b.id === activeBlockId);
    if (!block) return;
    const pageEl = pdfEl.querySelector<HTMLElement>(
      `[data-page-num="${block.page}"]`,
    );
    if (!pageEl) return;
    const targetTop =
      pageEl.offsetTop - pdfEl.offsetTop - PDF_BREATHING_ROOM_PX;
    runProgrammaticScroll("sync", pdfEl, targetTop);
  }, [leader, activeBlockId, doc, pdfRef]);
}
