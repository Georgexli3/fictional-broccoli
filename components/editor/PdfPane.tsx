"use client";

import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Loader2, Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { PdfPage } from "./PdfPage";
import { useBboxResolution } from "./useBboxResolution";
import { usePdfHoverScroll } from "./usePdfHoverScroll";

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
  /** Original PDF URL — read-only reference. */
  url: string;
  className?: string;
  /**
   * Parent-owned ref pointed at the inner scroll container. EditorBoot uses
   * this to drive bidirectional scroll-sync. Optional so existing call sites
   * that don't need scroll-sync still work.
   */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Read-only PDF reference pane.
 *
 * V1.7: passive viewer only — no Original/Edited toggle, no edit overlays,
 * no click-to-block. Just renders the original uploaded PDF as a vertical
 * stack of canvas + text-layer pairs, with hover-link from the right pane
 * scrolling this one to the matching page (`usePdfHoverScroll`).
 *
 * Defaults to hidden in `EditorBoot`; the user opens it via the header
 * "Show original" toggle when they want to verify against the source.
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
  const containerRef = externalRef ?? internalRef;
  usePdfHoverScroll(containerRef);
  useBboxResolution(doc);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setError(null);

    const loadingTask = pdfjsLib.getDocument({
      url,
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
  }, [url]);

  return (
    // `min-w-0` keeps the inner page wrapper from blowing out the grid column.
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

        {!doc && !error && (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading PDF…
          </div>
        )}

        {doc && (
          <div className="mx-auto flex max-w-full flex-col items-center gap-6">
            {Array.from({ length: pageCount }, (_, i) => (
              <PdfPage
                key={i + 1}
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
}

function Toolbar({ scale, onZoom, pageCount }: ToolbarProps) {
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
        <span className="text-muted-foreground/70 text-xs">
          Read-only reference
        </span>
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
