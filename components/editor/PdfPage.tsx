"use client";

import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";

import { useSessionStore } from "@/lib/session-store";
import { findBlockContainingPoint } from "@/lib/span-to-block";

import { PdfEditOverlay } from "./PdfEditOverlay";

interface PdfPageProps {
  doc: PDFDocumentProxy;
  pageNum: number;
  scale: number;
  rootRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * One PDF page: canvas (raster) + text-layer (transparent selectable spans).
 *
 * Lazy renders when the page enters the scroll viewport, so we don't render
 * 24 canvases up front. Re-renders when scale changes.
 *
 * The text layer is PDF.js's `TextLayer` — we don't roll our own positioned
 * spans because the layout math is fiddly and PDF.js's implementation
 * handles ligatures, RTL, and selection-across-spans correctly.
 */
export function PdfPage({ doc, pageNum, scale, rootRef }: PdfPageProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [shouldRender, setShouldRender] = useState(false);

  // Lazy render once the page comes near the viewport.
  useEffect(() => {
    if (!wrapperRef.current) return;
    if (shouldRender) return;
    const root = rootRef.current ?? null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShouldRender(true);
            observer.disconnect();
            break;
          }
        }
      },
      { root, rootMargin: "400px 0px" },
    );
    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, [shouldRender, rootRef]);

  // Get the page dimensions up front so the placeholder reserves space; this
  // lets the IntersectionObserver actually fire instead of all pages being at
  // y=0 at zero height.
  useEffect(() => {
    let cancelled = false;
    void doc.getPage(pageNum).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      setSize({ width: viewport.width, height: viewport.height });
    });
    return () => {
      cancelled = true;
    };
  }, [doc, pageNum, scale]);

  // Actual render once intersecting + scale changes.
  useEffect(() => {
    if (!shouldRender) return;
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;
    // V1.5 (Pattern C): cleanup functions for listeners attached AFTER
    // textLayer render. Tracked in an array so cancellation removes them
    // even if the listener was attached on a later async tick.
    const cleanup: Array<() => void> = [];

    void (async () => {
      const page = await doc.getPage(pageNum);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });

      const canvas = canvasRef.current;
      const textLayerDiv = textLayerRef.current;
      if (!canvas || !textLayerDiv) return;

      // Hi-DPI rendering for crisp text.
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(dpr, dpr);

      renderTask = page.render({
        canvasContext: context,
        viewport,
      });
      await renderTask.promise;
      if (cancelled) return;

      textLayerDiv.style.width = `${viewport.width}px`;
      textLayerDiv.style.height = `${viewport.height}px`;
      textLayerDiv.replaceChildren();

      const textContent = await page.getTextContent();
      if (cancelled) return;

      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
      });
      await textLayer.render();
      if (cancelled) return;

      // V1.5 (Pattern C): stamp `data-block-id` on each text-layer span by
      // looking up which block's resolved bbox contains the span's center.
      // Must run AFTER textLayer.render() because that call replaces the
      // children. Re-runs on every scale change naturally (this whole
      // effect re-fires).
      const blocksOnPage =
        useSessionStore
          .getState()
          .doc?.blocks.filter(
            (b) =>
              b.bboxResolved?.page === pageNum &&
              b.bboxResolved.confidence >= 0.4,
          ) ?? [];
      if (blocksOnPage.length > 0) {
        const spans = textLayerDiv.querySelectorAll<HTMLElement>("span");
        for (const span of spans) {
          const cx = span.offsetLeft + span.offsetWidth / 2;
          const cy = span.offsetTop + span.offsetHeight / 2;
          const cxAt1 = cx / scale;
          const cyAt1 = cy / scale;
          const blockId = findBlockContainingPoint(
            blocksOnPage,
            cxAt1,
            cyAt1,
          );
          if (blockId) span.dataset.blockId = blockId;
        }
      }

      // V1.5 (Pattern C): delegated click on text-layer → select block.
      const onClick = (e: MouseEvent) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        const span = target.closest<HTMLElement>("[data-block-id]");
        if (!span?.dataset.blockId) return;
        const id = span.dataset.blockId;
        useSessionStore.getState().selectBlock(id);
        // Scroll DocPane to the block — match ChangesSidebar's pattern.
        const node = document.querySelector(`[data-block-id="${id}"]`);
        node?.scrollIntoView({ behavior: "smooth", block: "center" });
      };
      textLayerDiv.addEventListener("click", onClick);
      cleanup.push(() => textLayerDiv.removeEventListener("click", onClick));

      // V1.5 (Pattern C): selection-settled detection. We listen on
      // `mouseup` + `keyup` instead of `selectionchange` because the latter
      // fires per-keystroke during shift+arrow extension and would flicker
      // the right-pane focus during an in-progress drag.
      const onSettle = () => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
        let node: Node | null = sel.getRangeAt(0).commonAncestorContainer;
        while (
          node &&
          !(node instanceof HTMLElement && node.dataset.blockId)
        ) {
          node = node.parentNode;
        }
        if (node instanceof HTMLElement && node.dataset.blockId) {
          useSessionStore.getState().setHoveredBlock(node.dataset.blockId);
        }
      };
      textLayerDiv.addEventListener("mouseup", onSettle);
      textLayerDiv.addEventListener("keyup", onSettle);
      cleanup.push(() =>
        textLayerDiv.removeEventListener("mouseup", onSettle),
      );
      cleanup.push(() =>
        textLayerDiv.removeEventListener("keyup", onSettle),
      );
    })().catch((error) => {
      if (cancelled) return;
      // eslint-disable-next-line no-console
      console.warn(`[PdfPage] failed to render page ${pageNum}`, error);
    });

    return () => {
      cancelled = true;
      cleanup.forEach((fn) => fn());
      try {
        renderTask?.cancel();
      } catch {
        // RenderTask cancellation throws sometimes; ignore.
      }
    };
  }, [doc, pageNum, scale, shouldRender]);

  return (
    <div
      ref={wrapperRef}
      className="relative bg-white shadow-md"
      style={
        size
          ? { width: size.width, height: size.height }
          : { width: 800, height: 1035 }
      }
      data-page-num={pageNum}
    >
      <canvas ref={canvasRef} className="block" />
      <div
        ref={textLayerRef}
        className="textLayer absolute top-0 left-0"
        aria-hidden="false"
      />
      <PdfEditOverlay pageNum={pageNum} scale={scale} />
    </div>
  );
}
