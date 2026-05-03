"use client";

import { useEffect } from "react";

import { currentText } from "@/lib/doc-model";
import { useSessionStore } from "@/lib/session-store";

/**
 * V1.7.2: populates `kbHints` in the session store after the doc loads.
 *
 * Re-fires only when the block-set identity changes (new upload, undo/redo
 * of an insert) — not on every text edit. The matcher is structural, not
 * granular; per-keystroke calls would spam /api/kb-match for no benefit.
 *
 * Implementation note: subscribes to `blockCount` and `pdfHash` (the only
 * inputs that should trigger a re-fire) and reads the full doc inside the
 * effect via `useSessionStore.getState()`. If we put the `doc` reference in
 * the dep array directly, every accepted edit creates a new doc object and
 * fires this hook again — see the V1.7.2 review for the perf bug this
 * shape avoided.
 *
 * Bails when the KB isn't loaded server-side (server returns empty
 * `matches`), when the doc isn't ready, or when there are no blocks.
 * Failures are silent — chips just don't render; the KB is a hint, not
 * load-bearing.
 */
export function useKbHints(): void {
  const setKbHints = useSessionStore((s) => s.setKbHints);
  const blockCount = useSessionStore((s) => s.doc?.blocks.length ?? 0);
  const pdfHash = useSessionStore((s) => (s.meta.ready ? s.meta.pdfHash : null));

  useEffect(() => {
    if (!pdfHash) return;
    if (blockCount === 0) return;

    const controller = new AbortController();

    void (async () => {
      const doc = useSessionStore.getState().doc;
      if (!doc) return;
      try {
        const res = await fetch("/api/kb-match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            excludeHash: pdfHash,
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
        setKbHints(json.matches as Parameters<typeof setKbHints>[0]);
      } catch {
        // Network / parse failure: chips just don't appear.
      }
    })();

    return () => controller.abort();
  }, [blockCount, pdfHash, setKbHints]);
}
