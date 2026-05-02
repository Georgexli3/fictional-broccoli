"use client";

import { useEffect, useRef } from "react";

import { useSessionStore } from "@/lib/session-store";

const REGEN_DEBOUNCE_MS = 500;

/**
 * V1.6: keeps the server-rendered "Edited" preview PDF in sync with the
 * user's edit history.
 *
 * Watches `doc.history.length` (only accepted edits count) and POSTs to
 * `/api/preview-pdf` after a 500ms debounce. The endpoint caches per
 * (docHash, historyLen), so re-runs are cheap once a version has been
 * generated — useful for undo/redo/refresh sequences.
 *
 * Stale-while-revalidate: we keep the previous URL mounted in the store
 * (`previewPdf.url`) while a new regen is in flight. The PDF pane shows the
 * older render with an "updating…" badge instead of going blank.
 *
 * Mounted once in `EditorBoot`. Bails when there are zero accepted edits
 * (nothing to highlight) and when the doc/meta isn't ready yet.
 */
export function usePreviewPdfRegen(): void {
  const doc = useSessionStore((s) => s.doc);
  const meta = useSessionStore((s) => s.meta);
  const setPreviewPdfState = useSessionStore((s) => s.setPreviewPdfState);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);

  // Number of accepted edits is the cache key on the server; using it as the
  // dependency avoids regenerating on rejected edits or block-bbox updates.
  const acceptedCount =
    doc?.history.filter((h) => h.status === "accepted").length ?? 0;

  useEffect(() => {
    if (!doc) return;
    if (!meta.ready) return;
    if (acceptedCount === 0) {
      // Reset preview state so toggling Edited mode after undoing all edits
      // doesn't show a stale URL.
      setPreviewPdfState({
        url: null,
        generatedAtHistoryLen: 0,
        isRegenerating: false,
        error: null,
      });
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // Cancel any in-flight regen — the new one supersedes it.
      if (inFlightRef.current) inFlightRef.current.abort();
      const controller = new AbortController();
      inFlightRef.current = controller;

      setPreviewPdfState({ isRegenerating: true, error: null });

      void (async () => {
        try {
          const res = await fetch("/api/preview-pdf", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              docHash: meta.pdfHash,
              blobUrl: meta.pdfBlobUrl,
              doc,
            }),
          });
          const json = (await res.json()) as
            | { ok: true; url: string; cached: boolean }
            | { ok: false; error: string };
          if (controller.signal.aborted) return;
          if (!json.ok) {
            setPreviewPdfState({
              isRegenerating: false,
              error: json.error,
            });
            return;
          }
          setPreviewPdfState({
            url: json.url,
            generatedAtHistoryLen: acceptedCount,
            isRegenerating: false,
            error: null,
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          setPreviewPdfState({
            isRegenerating: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    }, REGEN_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // We intentionally depend on `acceptedCount` and the meta identity, not
    // the doc object — the server cache-key is (docHash, acceptedCount), so
    // mid-edit doc-model mutations (bbox resolution, pendingEdit churn)
    // shouldn't trigger regen.
  }, [acceptedCount, meta, doc, setPreviewPdfState]);
}
