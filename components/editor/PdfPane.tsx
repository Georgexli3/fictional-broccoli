"use client";

import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Loader2, Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useSessionStore, usePdfViewMode } from "@/lib/session-store";
import { cn } from "@/lib/utils";

import { PdfPage } from "./PdfPage";
import { useBboxResolution } from "./useBboxResolution";
import { usePdfHoverScroll } from "./usePdfHoverScroll";
import { ViewModeToggle } from "./ViewModeToggle";

import "pdfjs-dist/web/pdf_viewer.css";
import "./pdf-pane.css";

// Set worker once on the client. Pinned locally in /public/pdfjs/.
if (typeof window !== "undefined" && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 3.0;
const SCALE_STEP = 0.15;

interface PdfPaneProps {
  /** Original PDF URL — always used in Original mode. */
  url: string;
  className?: string;
  /**
   * V1.6: parent-owned ref pointed at the inner scroll container. EditorBoot
   * uses this to drive bidirectional scroll-sync. Optional so existing call
   * sites that don't need scroll-sync still work.
   */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * PDF viewer (left pane).
 *
 * Renders the PDF as a vertical stack of canvas+text-layer pairs. Pages
 * render on demand as they enter the viewport (IntersectionObserver) so we
 * don't lock the main thread on a 24-page proposal at boot.
 *
 * V1.6: this is now a PASSIVE viewer — no click-to-block, no drag-select-to-
 * scroll handlers. The previous attempt at "interactive PDF text" via the
 * bbox resolver was too fragile (low-confidence regions misroute clicks).
 * All editing happens in the DocPane; the PDF is purely a visual reference.
 *
 * The Original/Edited toggle swaps which PDF we load: original blob URL or
 * the server-rendered preview (`buildEditedPreviewPdf` → cached on Vercel
 * Blob). Switching modes triggers a full PDF reload — that's intentional, so
 * the user sees the actual rendered highlights, not CSS overlays.
 */
export function PdfPane({
  url,
  className,
  scrollContainerRef: externalRef,
}: PdfPaneProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1.2);
  const internalRef = useRef<HTMLDivElement | null>(null);
  // If parent passes a ref, use it; otherwise fall back to local ref.
  const containerRef = externalRef ?? internalRef;
  usePdfHoverScroll(containerRef);
  useBboxResolution(doc);

  const mode = usePdfViewMode();
  const previewPdf = useSessionStore((s) => s.previewPdf);

  // Effective URL: original mode always uses the original blob. Edited mode
  // uses the regenerated preview if available, otherwise stays on the
  // original (the regen hook will fill it in shortly; the toolbar shows a
  // "Updating preview…" badge during the gap).
  const effectiveUrl = mode === "edited" && previewPdf.url ? previewPdf.url : url;

  useEffect(() => {
    if (!effectiveUrl) return;
    let cancelled = false;
    setError(null);

    const loadingTask = pdfjsLib.getDocument({
      url: effectiveUrl,
      withCredentials: false,
    });

    loadingTask.promise
      .then((pdf) => {
        if (cancelled) return;
        setDoc(pdf);
        setPageCount(pdf.numPages);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      });

    return () => {
      cancelled = true;
      void loadingTask.destroy();
    };
  }, [effectiveUrl]);

  const editedRequestedButNotReady =
    mode === "edited" && !previewPdf.url && previewPdf.isRegenerating;

  return (
    // `min-w-0` is critical: without it, the inner PDF page wrapper (~734px
    // wide at scale 1.2) expands the parent grid column past its 1fr
    // allocation, which makes the PDF overlap the right pane.
    <div className={cn("flex h-full min-w-0 flex-col", className)}>
      <Toolbar
        scale={scale}
        onZoom={(direction) => {
          setScale((s) => {
            const next =
              direction === "in"
                ? Math.min(MAX_SCALE, s + SCALE_STEP)
                : direction === "out"
                  ? Math.max(MIN_SCALE, s - SCALE_STEP)
                  : 1.2;
            return Number(next.toFixed(2));
          });
        }}
        pageCount={pageCount}
        regenerating={mode === "edited" && previewPdf.isRegenerating}
      />

      <div
        ref={containerRef}
        className="bg-muted/40 flex-1 overflow-auto px-6 py-6"
      >
        {error && (
          <div className="text-danger mx-auto max-w-md rounded-lg bg-red-50 px-4 py-3 text-sm dark:bg-red-950/30">
            Failed to load PDF: {error}
          </div>
        )}

        {editedRequestedButNotReady && !error && (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating edited preview…
          </div>
        )}

        {!doc && !error && !editedRequestedButNotReady && (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading PDF…
          </div>
        )}

        {doc && !editedRequestedButNotReady && (
          <div className="mx-auto flex max-w-full flex-col items-center gap-6">
            {Array.from({ length: pageCount }, (_, i) => (
              <PdfPage
                key={`${effectiveUrl}-${i + 1}`}
                doc={doc}
                pageNum={i + 1}
                scale={scale}
                rootRef={containerRef}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ToolbarProps {
  scale: number;
  onZoom: (direction: "in" | "out" | "reset") => void;
  pageCount: number;
  regenerating: boolean;
}

function Toolbar({ scale, onZoom, pageCount, regenerating }: ToolbarProps) {
  return (
    <div className="border-border bg-background flex items-center justify-between gap-3 border-b px-4 py-2 text-sm">
      <div className="text-muted-foreground flex items-center gap-3">
        <span>
          {pageCount > 0 ? (
            <>
              {pageCount} page{pageCount === 1 ? "" : "s"}
            </>
          ) : (
            "—"
          )}
        </span>
        <ViewModeToggle />
        {regenerating && (
          <span className="flex items-center gap-1 text-xs">
            <Loader2 className="h-3 w-3 animate-spin" />
            updating…
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onZoom("out")}
          className="hover:bg-muted rounded p-1.5 transition"
          aria-label="Zoom out"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="text-muted-foreground w-12 text-center font-mono text-xs">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          onClick={() => onZoom("in")}
          className="hover:bg-muted rounded p-1.5 transition"
          aria-label="Zoom in"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onZoom("reset")}
          className="hover:bg-muted ml-1 rounded p-1.5 transition"
          aria-label="Reset zoom"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
