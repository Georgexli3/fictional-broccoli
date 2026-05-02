"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { currentText } from "@/lib/doc-model";
import { useSessionStore } from "@/lib/session-store";
import { cn } from "@/lib/utils";

import { BlockView } from "./BlockView";
import { DocPreview } from "./DocPreview";
import { useActiveBlockTracking } from "./useActiveBlockTracking";

interface DocPaneProps {
  blobUrl: string;
  hash: string;
  className?: string;
  /**
   * Parent-owned ref to the inner scroll container. EditorBoot uses this
   * to drive `usePaneScrollSync`. Optional so the component can run standalone
   * (e.g. in unit tests) with a local fallback ref.
   */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
}

type ParseState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; fromCache: boolean }
  | { status: "error"; error: string };

type ViewMode = "edit" | "preview";

/**
 * Doc-model viewer (center pane).
 *
 * Pulls parsed model from /api/parse on mount. Once loaded, the doc lives
 * in the session store; this component just renders blocks from the store.
 *
 * V1.7: adds an Edit ↔ Preview toggle. Edit mode renders the editable
 * `BlockView` list (V1 behavior). Preview mode renders the doc as styled
 * HTML with inline track-changes (red strikethrough + green underline) —
 * what replaced the old "Edited PDF" view, since we can't faithfully
 * regenerate a PDF and HTML print-to-PDF is the user's escape hatch.
 *
 * `useActiveBlockTracking` runs in both modes so the ChangesPanel keeps
 * focusing the right entry as the viewport moves.
 */
export function DocPane({
  blobUrl,
  hash,
  className,
  scrollContainerRef: externalRef,
}: DocPaneProps) {
  const doc = useSessionStore((s) => s.doc);
  const setDoc = useSessionStore((s) => s.setDoc);
  const [state, setState] = useState<ParseState>({ status: "idle" });
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const internalRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = externalRef ?? internalRef;
  useActiveBlockTracking(scrollRef);

  // Fetch parse on mount, unless we already have a doc in the store
  // (resuming from localStorage).
  useEffect(() => {
    if (!blobUrl || !hash) return;
    if (doc) {
      setState({ status: "ready", fromCache: true });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    void (async () => {
      try {
        const response = await fetch("/api/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blobUrl, hash }),
        });
        const json = await response.json();
        if (cancelled) return;
        if (!response.ok || !json.ok) {
          setState({
            status: "error",
            error: json.error ?? `HTTP ${response.status}`,
          });
          return;
        }
        setDoc(json.doc);
        setState({ status: "ready", fromCache: json.cached });
      } catch (error) {
        if (cancelled) return;
        setState({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blobUrl, hash, doc, setDoc]);

  if (state.status === "idle" || state.status === "loading") {
    return (
      <div
        className={cn(
          "flex h-full items-center justify-center text-sm",
          className,
        )}
      >
        <div className="text-muted-foreground flex flex-col items-center gap-3">
          <Loader2 className="text-accent h-6 w-6 animate-spin" />
          <p>Parsing PDF — Claude Sonnet 4.6 reads the structure…</p>
          <p className="text-muted-foreground/70 text-xs">
            (Typical 20-page proposal: 10–20s. Cached on second upload.)
          </p>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className={cn("p-6", className)}>
        <div className="text-danger rounded-lg bg-red-50 px-4 py-3 text-sm dark:bg-red-950/30">
          <p className="font-semibold">Failed to parse PDF</p>
          <p className="mt-1">{state.error}</p>
        </div>
      </div>
    );
  }

  if (!doc) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col overflow-hidden text-sm",
        className,
      )}
    >
      <header className="border-border bg-background flex items-center justify-between border-b px-4 py-2">
        <div className="text-muted-foreground flex items-center gap-3">
          <span>
            {doc.blocks.length} block{doc.blocks.length === 1 ? "" : "s"}
          </span>
          {state.fromCache && (
            <span className="bg-accent/10 text-accent rounded px-1.5 py-0.5 text-xs">
              cached
            </span>
          )}
          {doc.history.length > 0 && (
            <span>
              · {doc.history.length} edit{doc.history.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <div
          role="group"
          aria-label="View mode"
          className="border-border bg-muted/40 inline-flex h-7 items-center rounded-full border p-0.5 text-xs"
        >
          <button
            type="button"
            onClick={() => setViewMode("edit")}
            className={cn(
              "h-6 rounded-full px-3 transition",
              viewMode === "edit"
                ? "bg-accent text-accent-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setViewMode("preview")}
            className={cn(
              "h-6 rounded-full px-3 transition",
              viewMode === "preview"
                ? "bg-accent text-accent-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Preview
          </button>
        </div>
      </header>
      <div
        ref={scrollRef}
        className={cn(
          "flex-1 overflow-auto",
          viewMode === "edit" ? "space-y-3 px-6 py-4" : "",
        )}
      >
        {viewMode === "edit"
          ? doc.blocks.map((block, i) => {
              const prev = doc.blocks[i - 1];
              const next = doc.blocks[i + 1];
              return (
                <BlockView
                  key={block.id}
                  block={block}
                  text={currentText(block)}
                  contextBefore={prev ? currentText(prev) : undefined}
                  contextAfter={next ? currentText(next) : undefined}
                />
              );
            })
          : (
            <DocPreview doc={doc} />
          )}
      </div>
    </div>
  );
}
