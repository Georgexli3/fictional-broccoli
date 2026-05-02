"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef } from "react";

import {
  resolveBlockBbox,
  type PageTextLayer,
} from "@/lib/bbox-resolver";
import { currentText } from "@/lib/doc-model";
import { useSessionStore } from "@/lib/session-store";

/**
 * After the PDF loads + the doc model is parsed, run the bbox resolver
 * across every editable block and persist the resolved positions into the
 * doc model. Used by the annotated-export to position markers.
 *
 * Idempotent: if `bboxResolved` is already set on every block, skips.
 */
export function useBboxResolution(pdf: PDFDocumentProxy | null) {
  const doc = useSessionStore((s) => s.doc);
  const updateBboxes = useSessionStore((s) => s.updateBlockBboxes);
  const resolvedRef = useRef(false);

  useEffect(() => {
    if (!pdf || !doc) return;
    if (resolvedRef.current) return;
    // If every editable block already has bbox resolved, skip.
    const editableBlocks = doc.blocks.filter((b) => b.editable);
    if (
      editableBlocks.length > 0 &&
      editableBlocks.every((b) => b.bboxResolved)
    ) {
      resolvedRef.current = true;
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const layers: PageTextLayer[] = [];
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1 });
          const textContent = await page.getTextContent();
          layers.push({
            page: pageNum,
            pageHeight: viewport.height,
            items: textContent.items
              .filter(
                (it): it is import("pdfjs-dist/types/src/display/api").TextItem =>
                  "str" in it,
              )
              .map((it) => ({
                str: it.str,
                transform: it.transform,
                width: it.width,
                height: it.height,
              })),
          });
        }
        if (cancelled) return;

        const updates: Parameters<typeof updateBboxes>[0] = [];
        for (const block of editableBlocks) {
          if (block.bboxResolved) continue;
          const text = currentText(block);
          const resolution = resolveBlockBbox(text, layers, block.page);
          if (!resolution) continue;
          updates.push({
            blockId: block.id,
            page: resolution.bbox.page,
            x: resolution.bbox.x,
            y: resolution.bbox.y,
            w: resolution.bbox.w,
            h: resolution.bbox.h,
            confidence: resolution.confidence,
          });
        }

        if (cancelled) return;
        if (updates.length > 0) {
          updateBboxes(updates);
        }
        resolvedRef.current = true;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[bbox-resolution] failed:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdf, doc, updateBboxes]);
}
