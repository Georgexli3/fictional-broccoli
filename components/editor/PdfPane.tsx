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
  url: string;
  className?: string;
}

/**
 * PDF viewer (left pane).
 *
 * Renders the PDF as a vertical stack of canvas+text-layer pairs. Pages
 * render on demand as they enter the viewport (IntersectionObserver) so we
 * don't lock the main thread on a 24-page proposal at boot.
 *
 * Text layer is the PDF.js native one — transparent overlay with positioned
 * text spans, so browser-native text selection works on the rendered PDF.
 * Selection events are surfaced (M8 hover-link wires them to the right pane).
 */
export function PdfPane({ url, className }: PdfPaneProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1.2);
  const containerRef = useRef<HTMLDivElement>(null);
  usePdfHoverScroll(containerRef);
  useBboxResolution(doc);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setError(null);

    const loadingTask = pdfjsLib.getDocument({
      url,
      // PDF.js can fetch CORS-restricted blobs through the proxy; for our
      // Vercel Blob URLs CORS is permissive, but we pass the standard fetch
      // signal anyway.
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
    // `min-w-0` is critical: without it, the inner PDF page wrapper (~734px
    // wide at scale 1.2) expands the parent grid column past its 1fr
    // allocation, which makes the PDF text-layer overlap the right pane and
    // intercept clicks on the edit composer / Discard buttons.
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
    <div className="border-border bg-background flex items-center justify-between border-b px-4 py-2 text-sm">
      <div className="text-muted-foreground">
        {pageCount > 0 ? (
          <>
            {pageCount} page{pageCount === 1 ? "" : "s"}
          </>
        ) : (
          "—"
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
