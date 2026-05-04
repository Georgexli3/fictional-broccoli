/**
 * Lightweight telemetry shim.
 *
 * In dev: console.log only.
 * In prod: POSTs to /api/events (which is currently a no-op; scaffolded for
 * Posthog wiring in V1.5).
 *
 * The event vocabulary is the load-bearing piece — wiring an actual analytics
 * backend later doesn't require changing call sites.
 */

export type TrackEvent =
  | { name: "pdf_uploaded"; size: number; pageCount?: number; hash: string }
  | {
      name: "pdf_parsed";
      hash: string;
      durationMs: number;
      blockCount: number;
      cached: boolean;
    }
  | {
      name: "edit_proposed";
      intent: string;
      blockKind: string;
      promptLength: number;
      durationMs: number;
      outputLength: number;
    }
  | { name: "edit_accepted"; intent: string; blockId: string }
  | { name: "edit_discarded"; intent: string; blockId: string }
  | { name: "edit_undone" }
  | { name: "edit_redone" }
  | {
      name: "export_clicked";
      format: "annotated" | "clean" | "markdown" | "docx" | "docx-clean";
    }
  | { name: "session_resumed"; ageMinutes: number; editCount: number }
  | { name: "error_surfaced"; kind: string; messageHash: string };

export function track(event: TrackEvent) {
  if (typeof window === "undefined") return;
  // eslint-disable-next-line no-console
  console.log("[track]", event.name, event);
  void fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch(() => {
    // no-op
  });
}
