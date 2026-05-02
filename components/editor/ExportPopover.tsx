"use client";

import { Download, FileCode, FileText, FileType, Loader2 } from "lucide-react";
import { useState } from "react";

import { useSessionStore } from "@/lib/session-store";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";

type Format = "markdown" | "docx" | "clean" | "annotated";

export function ExportPopover() {
  const meta = useSessionStore((s) => s.meta);
  const doc = useSessionStore((s) => s.doc);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!meta.ready) return null;

  const exportAs = async (format: Format) => {
    if (!doc) return;
    setBusy(format);
    setError(null);
    track({ name: "export_clicked", format });
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          title: meta.filename.replace(/\.pdf$/i, ""),
          doc,
          blobUrl: meta.pdfBlobUrl,
        }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.error ?? `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const filename =
        response.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] ??
        `${meta.filename.replace(/\.pdf$/i, "")}-edited`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        disabled={!doc}
        className="bg-accent text-accent-foreground inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" />
        Export
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="border-border bg-background absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-md border shadow-lg">
            <ExportRow
              icon={<FileType className="h-4 w-4" />}
              title="Word (.docx) with track changes"
              description="Edits encoded as native Word revisions — accept/reject in the Review pane. Recommended."
              busy={busy === "docx"}
              onClick={() => void exportAs("docx")}
            />
            <ExportRow
              icon={<FileCode className="h-4 w-4" />}
              title="Markdown"
              description="Clean text, ideal for pasting into Word/Notion."
              busy={busy === "markdown"}
              onClick={() => void exportAs("markdown")}
            />
            <ExportRow
              icon={<FileText className="h-4 w-4" />}
              title="Clean PDF"
              description="Fresh PDF rebuilt from the edited doc model. No original branding."
              busy={busy === "clean"}
              onClick={() => void exportAs("clean")}
            />
            <ExportRow
              icon={<FileText className="h-4 w-4" />}
              title="Annotated Original"
              description="Original layout + edit markers + Changes Summary. For review/redlining."
              busy={busy === "annotated"}
              onClick={() => void exportAs("annotated")}
            />
            {error && (
              <div className="text-danger border-border border-t bg-red-50 px-3 py-2 text-xs dark:bg-red-950/30">
                {error}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ExportRow({
  icon,
  title,
  description,
  busy,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  busy: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={cn(
        "hover:bg-muted/60 flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition",
        (busy || disabled) && "cursor-not-allowed opacity-50",
      )}
    >
      <div className="text-accent mt-0.5">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      </div>
      <div className="flex-1">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}
