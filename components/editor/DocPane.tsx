"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { currentText } from "@/lib/doc-model";
import { useSessionStore } from "@/lib/session-store";
import { cn } from "@/lib/utils";

import { BlockView } from "./BlockView";

interface DocPaneProps {
  blobUrl: string;
  hash: string;
  className?: string;
}

type ParseState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; fromCache: boolean }
  | { status: "error"; error: string };

/**
 * Doc-model viewer (right pane).
 *
 * Pulls parsed model from /api/parse on mount. Once loaded, the doc lives
 * in the session store; this component just renders blocks from the store.
 */
export function DocPane({ blobUrl, hash, className }: DocPaneProps) {
  const doc = useSessionStore((s) => s.doc);
  const setDoc = useSessionStore((s) => s.setDoc);
  const [state, setState] = useState<ParseState>({ status: "idle" });

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
        "flex h-full flex-col overflow-hidden text-sm",
        className,
      )}
    >
      <header className="border-border bg-background flex items-center justify-between border-b px-4 py-2">
        <div className="text-muted-foreground">
          {doc.blocks.length} block{doc.blocks.length === 1 ? "" : "s"}
          {state.fromCache && (
            <span className="bg-accent/10 text-accent ml-2 rounded px-1.5 py-0.5 text-xs">
              cached
            </span>
          )}
          {doc.history.length > 0 && (
            <span className="ml-2">· {doc.history.length} edit{doc.history.length === 1 ? "" : "s"}</span>
          )}
        </div>
      </header>
      <div className="flex-1 space-y-3 overflow-auto px-6 py-4">
        {doc.blocks.map((block, i) => {
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
        })}
      </div>
    </div>
  );
}
