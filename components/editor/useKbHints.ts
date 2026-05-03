"use client";

import { useEffect } from "react";

import { currentText } from "@/lib/doc-model";
import { useSessionStore } from "@/lib/session-store";

/**
 * V1.7.2: populates `kbHints` in the session store after the doc loads.
 *
 * Mounted once in `EditorBoot`. Watches the doc's block-set identity
 * (`blocks.length`) — re-fires only when blocks are added/removed, not on
 * every text edit, since the topic match is meant to be ambient guidance,
 * not a real-time index.
 *
 * Bails when the KB isn't loaded server-side (returns empty `matches`),
 * when the doc isn't ready, or when there are no blocks. Failures are
 * silent — the chips just don't render. Logging-only is the right level
 * since the KB is a hint, not load-bearing.
 */
export function useKbHints(): void {
  const doc = useSessionStore((s) => s.doc);
  const meta = useSessionStore((s) => s.meta);
  const setKbHints = useSessionStore((s) => s.setKbHints);
  const blockCount = doc?.blocks.length ?? 0;

  useEffect(() => {
    if (!doc) return;
    if (!meta.ready) return;
    if (blockCount === 0) return;

    const controller = new AbortController();

    void (async () => {
      try {
        const res = await fetch("/api/kb-match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            excludeHash: meta.pdfHash,
            blocks: doc.blocks.map((b) => ({
              id: b.id,
              kind: b.kind,
              text: currentText(b),
            })),
          }),
        });
        if (!res.ok) return;
        const json = (await res.json()) as
          | { ok: true; matches: Record<string, unknown> }
          | { ok: false; error: string };
        if (controller.signal.aborted) return;
        if (!json.ok) return;
        // Type-safe coercion via assignment back through the action signature.
        setKbHints(
          json.matches as Parameters<typeof setKbHints>[0],
        );
      } catch {
        // Silent — the chips just don't appear.
      }
    })();

    return () => controller.abort();
    // Re-run when block count changes (parse → ready, undo/redo of an insert).
    // Don't re-run on text edits — the hint is structural, not granular.
  }, [blockCount, doc, meta, setKbHints]);
}
