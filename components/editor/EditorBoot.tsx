"use client";

import { ArrowLeft, FileText, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { clearSession } from "@/lib/persistence";
import { flushSession, useSessionStore } from "@/lib/session-store";
import { track } from "@/lib/track";
import { cn, formatBytes } from "@/lib/utils";

import { ChangesPanel } from "./ChangesPanel";
import { DocPane } from "./DocPane";
import { EditorKeyboardShortcuts } from "./EditorKeyboardShortcuts";
import { ExportPopover } from "./ExportPopover";
import { PdfPane } from "./PdfPane";
import { usePaneScrollSync } from "./usePaneScrollSync";

interface EditorBootProps {
  docHash: string;
}

/**
 * Hydrates the editor session from localStorage. Bounces home if the
 * requested hash isn't the active session.
 *
 * V1.7 layout — DocPane + ChangesPanel are always visible; the original PDF
 * is opt-in via a header toggle (default closed). Grid switches between
 * 2-col `[1fr_320px]` and 3-col `[1fr_1fr_320px]` based on PDF visibility.
 *
 * The PDF is passive read-only reference now — no Original/Edited modes,
 * no overlays. Scroll-sync still wires the PDF to the editor when the user
 * has it open so both panes track each other.
 */
export function EditorBoot({ docHash }: EditorBootProps) {
  const router = useRouter();
  const hydrate = useSessionStore((s) => s.hydrate);
  const meta = useSessionStore((s) => s.meta);
  const [hydrated, setHydrated] = useState(false);
  const [showPdf, setShowPdf] = useState(false);

  const pdfScrollRef = useRef<HTMLDivElement | null>(null);
  const docScrollRef = useRef<HTMLDivElement | null>(null);
  usePaneScrollSync(pdfScrollRef, docScrollRef);

  useEffect(() => {
    const ok = hydrate(docHash);
    if (!ok) {
      router.replace("/");
      return;
    }
    setHydrated(true);
    const stored = useSessionStore.getState();
    if (stored.meta.ready) {
      const ageMinutes = Math.floor(
        (Date.now() - stored.meta.uploadedAt) / 60000,
      );
      const editCount = stored.doc?.history.length ?? 0;
      if (ageMinutes > 0 || editCount > 0) {
        track({
          name: "session_resumed",
          ageMinutes,
          editCount,
        });
      }
    }
  }, [docHash, hydrate, router]);

  useEffect(() => {
    return () => {
      flushSession();
    };
  }, []);

  if (!hydrated || !meta.ready) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading session…</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <EditorKeyboardShortcuts />
      <header className="border-border flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
            onClick={() => clearSession()}
          >
            <ArrowLeft className="h-4 w-4" />
            New upload
          </Link>
          <div className="text-muted-foreground/50">/</div>
          <div className="flex items-center gap-2 text-sm">
            <FileText className="text-muted-foreground h-4 w-4" />
            <span className="font-medium">{meta.filename}</span>
            <span className="text-muted-foreground">
              · {formatBytes(meta.size)} ·{" "}
              <code className="font-mono text-xs">
                {meta.pdfHash.slice(0, 8)}
              </code>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPdf((v) => !v)}
            className="text-muted-foreground hover:text-foreground border-border inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition"
            aria-pressed={showPdf}
          >
            {showPdf ? (
              <PanelLeftClose className="h-3.5 w-3.5" />
            ) : (
              <PanelLeftOpen className="h-3.5 w-3.5" />
            )}
            {showPdf ? "Hide original" : "Show original"}
          </button>
          <ExportPopover />
        </div>
      </header>

      <div
        className={cn(
          "border-border grid h-[calc(100vh-49px)] divide-x",
          showPdf ? "grid-cols-[1fr_1fr_320px]" : "grid-cols-[1fr_320px]",
        )}
      >
        {showPdf && (
          <PdfPane url={meta.pdfBlobUrl} scrollContainerRef={pdfScrollRef} />
        )}
        <DocPane
          blobUrl={meta.pdfBlobUrl}
          hash={meta.pdfHash}
          scrollContainerRef={docScrollRef}
        />
        <ChangesPanel />
      </div>
    </main>
  );
}
