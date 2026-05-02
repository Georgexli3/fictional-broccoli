"use client";

import { ArrowLeft, FileText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { clearSession } from "@/lib/persistence";
import { flushSession, useSessionStore } from "@/lib/session-store";
import { track } from "@/lib/track";
import { formatBytes } from "@/lib/utils";

import { ChangesSidebar } from "./ChangesSidebar";
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
 * Mounts the 3-pane layout: PdfPane (left, immutable) + DocPane (center,
 * editable) + ChangesSidebar (right edge, collapsible by hiding when no
 * edits — V1 keeps it always-visible for demo clarity).
 */
export function EditorBoot({ docHash }: EditorBootProps) {
  const router = useRouter();
  const hydrate = useSessionStore((s) => s.hydrate);
  const meta = useSessionStore((s) => s.meta);
  const [hydrated, setHydrated] = useState(false);

  // V1.5: parent-owned refs for the two scroll containers. Both panes wire
  // these to their inner scroll divs. usePaneScrollSync drives bidirectional
  // sync from these refs.
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
    // Track resume only if the doc has any edits or is "old".
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

  // Flush on unmount so unsaved debounced writes hit localStorage.
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
        <ExportPopover />
      </header>

      <div className="border-border grid h-[calc(100vh-49px)] grid-cols-[1fr_1fr_320px] divide-x">
        <PdfPane
          url={meta.pdfBlobUrl}
          scrollContainerRef={pdfScrollRef}
        />
        <DocPane
          blobUrl={meta.pdfBlobUrl}
          hash={meta.pdfHash}
          scrollContainerRef={docScrollRef}
        />
        <ChangesSidebar />
      </div>
    </main>
  );
}
