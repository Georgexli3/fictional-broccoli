"use client";

import { Clock, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { clearSession, readSession } from "@/lib/persistence";
import { formatRelativeTime } from "@/lib/utils";

/**
 * Resume banner. Appears on the home page if a prior session exists in
 * localStorage.
 *
 * One of the brief's "UX details that matter" — a 20-edit session shouldn't
 * vanish on a refresh.
 */
export function ResumeBanner() {
  const [session, setSession] = useState<ReturnType<typeof readSession>>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSession(readSession());
    setHydrated(true);
  }, []);

  if (!hydrated || !session) return null;

  const editCount = session.doc?.history.length ?? 0;

  return (
    <div className="border-accent/30 bg-accent/5 flex w-full items-center justify-between rounded-lg border px-4 py-3 text-sm">
      <div className="flex items-center gap-3">
        <Clock className="text-accent h-4 w-4" />
        <div>
          <p className="font-medium">
            Resume editing{" "}
            <span className="text-foreground">{session.filename}</span>?
          </p>
          <p className="text-muted-foreground text-xs">
            {editCount === 0
              ? "No edits yet"
              : `${editCount} edit${editCount === 1 ? "" : "s"}`}{" "}
            · {formatRelativeTime(session.uploadedAt)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            clearSession();
            setSession(null);
          }}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 px-2 py-1 text-xs"
        >
          <X className="h-3 w-3" />
          Discard
        </button>
        <Link
          href={`/editor/${session.pdfHash}`}
          className="bg-accent text-accent-foreground inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium hover:opacity-90"
        >
          Resume
        </Link>
      </div>
    </div>
  );
}
