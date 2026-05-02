"use client";

import { upload } from "@vercel/blob/client";
import { FileUp, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { isAcceptablePdfFile } from "@/lib/blob";
import { sha256OfFile } from "@/lib/hash";
import { startSession } from "@/lib/persistence";
import { cn, formatBytes } from "@/lib/utils";

type Stage = "idle" | "hashing" | "uploading" | "redirecting";

interface ProgressInfo {
  stage: Stage;
  filename?: string;
  size?: number;
  uploadPct?: number;
}

export function UploadDropzone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<ProgressInfo>({ stage: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setDragging] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);

      const validation = isAcceptablePdfFile(file);
      if (!validation.ok) {
        setError(validation.reason);
        return;
      }

      try {
        setProgress({
          stage: "hashing",
          filename: file.name,
          size: file.size,
        });
        const hash = await sha256OfFile(file);

        setProgress({
          stage: "uploading",
          filename: file.name,
          size: file.size,
          uploadPct: 0,
        });

        // Path is content-addressed by hash, so re-upload of the same PDF
        // would normally fail with "blob already exists". `allowOverwrite`
        // makes re-uploads idempotent (identical bytes overwrite themselves)
        // — the user shouldn't see an error for uploading the same file twice.
        const blob = await upload(`proposals/${hash}.pdf`, file, {
          access: "public",
          handleUploadUrl: "/api/blob-token",
          contentType: "application/pdf",
          clientPayload: JSON.stringify({
            hash,
            size: file.size,
            filename: file.name,
          }),
          allowOverwrite: true,
          onUploadProgress: (event) => {
            setProgress((prev) => ({
              ...prev,
              uploadPct: Math.round(event.percentage),
            }));
          },
        });

        startSession({
          pdfBlobUrl: blob.url,
          pdfHash: hash,
          filename: file.name,
          size: file.size,
          uploadedAt: Date.now(),
        });

        setProgress({
          stage: "redirecting",
          filename: file.name,
          size: file.size,
        });
        router.push(`/editor/${hash}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Upload failed: ${message}`);
        setProgress({ stage: "idle" });
      }
    },
    [router],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const isBusy = progress.stage !== "idle";

  return (
    <div className="w-full space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !isBusy && inputRef.current?.click()}
        className={cn(
          "border-border bg-muted hover:border-accent flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 text-center transition",
          isBusy ? "cursor-wait" : "cursor-pointer",
          isDragging && "border-accent bg-accent/5",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={onChange}
          disabled={isBusy}
        />

        {progress.stage === "idle" && (
          <>
            <FileUp className="text-muted-foreground mb-3 h-10 w-10" />
            <p className="font-medium">Drop a proposal PDF here</p>
            <p className="text-muted-foreground mt-1 text-sm">
              or click to choose a file (max 32 MB)
            </p>
          </>
        )}

        {progress.stage === "hashing" && (
          <UploadStage
            label="Hashing PDF…"
            sub={`${progress.filename} • ${formatBytes(progress.size ?? 0)}`}
          />
        )}

        {progress.stage === "uploading" && (
          <UploadStage
            label={`Uploading… ${progress.uploadPct ?? 0}%`}
            sub={`${progress.filename} • ${formatBytes(progress.size ?? 0)}`}
          >
            <div className="bg-border mt-3 h-1.5 w-64 overflow-hidden rounded-full">
              <div
                className="bg-accent h-full transition-[width]"
                style={{ width: `${progress.uploadPct ?? 0}%` }}
              />
            </div>
          </UploadStage>
        )}

        {progress.stage === "redirecting" && (
          <UploadStage
            label="Opening editor…"
            sub={`${progress.filename} • ${formatBytes(progress.size ?? 0)}`}
          />
        )}
      </div>

      {error && (
        <p className="text-danger rounded-lg bg-red-50 px-4 py-3 text-sm dark:bg-red-950/30">
          {error}
        </p>
      )}
    </div>
  );
}

function UploadStage({
  label,
  sub,
  children,
}: {
  label: string;
  sub: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center">
      <Loader2 className="text-accent mb-3 h-8 w-8 animate-spin" />
      <p className="font-medium">{label}</p>
      <p className="text-muted-foreground mt-1 text-sm">{sub}</p>
      {children}
    </div>
  );
}
