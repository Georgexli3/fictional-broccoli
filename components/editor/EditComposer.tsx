"use client";

import {
  Bookmark,
  CornerDownLeft,
  Loader2,
  Pencil,
  RotateCw,
  Scissors,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { diffIsEmpty } from "@/lib/diff";
import { currentText, type Block, type EditIntent } from "@/lib/doc-model";
import { streamEdit } from "@/lib/edit-stream";
import { useSessionStore } from "@/lib/session-store";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";

import { DiffView } from "./DiffView";

interface EditComposerProps {
  block: Block;
  contextBefore?: string;
  contextAfter?: string;
}

/**
 * Inline edit composer.
 *
 * 4 chips (Tighten / Match firm voice / Fix names / Reference past work) +
 * free-form textarea. Submitting fires `/api/edit` and the proposed-change
 * panel renders the streamed (M6) or non-streamed (M5) result with a
 * client-side diff. Accept applies the edit; Discard drops it.
 *
 * Keyboard:
 *   - Cmd/Ctrl+Enter: submit free-form
 *   - Esc: cancel selection
 */
export function EditComposer({
  block,
  contextBefore,
  contextAfter,
}: EditComposerProps) {
  const startEdit = useSessionStore((s) => s.startPendingEdit);
  const setResult = useSessionStore((s) => s.setPendingEditResult);
  const setError = useSessionStore((s) => s.setPendingEditError);
  const clearEdit = useSessionStore((s) => s.clearPendingEdit);
  const acceptEdit = useSessionStore((s) => s.acceptPendingEdit);
  const selectBlock = useSessionStore((s) => s.selectBlock);
  const pendingEdit = useSessionStore((s) => s.pendingEdit);
  const intentPrefill = useSessionStore((s) => s.intentPrefill);
  const setIntentPrefill = useSessionStore((s) => s.setIntentPrefill);
  const kbHint = useSessionStore((s) => s.kbHints[block.id]);

  const selectionPrefill = useSessionStore((s) => s.selectionPrefill);
  const initialPrompt = selectionPrefill
    ? `Replace '${selectionPrefill}' with `
    : "";
  const [prompt, setPrompt] = useState(initialPrompt);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.focus();
    // If we pre-filled, place cursor at the end so the user can immediately
    // type the replacement.
    const el = textareaRef.current;
    el.setSelectionRange(el.value.length, el.value.length);
  }, [block.id]);

  const beforeText = currentText(block);

  const submit = async (intent: EditIntent, userPrompt?: string) => {
    if (intent === "freeform" && !userPrompt?.trim()) return;
    startEdit({ blockId: block.id, intent, userPrompt });
    const startedAt = Date.now();
    try {
      const finalText = await streamEdit(
        {
          blockId: block.id,
          beforeText,
          intent,
          userPrompt,
          contextBefore,
          contextAfter,
        },
        {
          onChunk: (partial) => setResult(partial),
        },
      );
      setResult(finalText);
      track({
        name: "edit_proposed",
        intent,
        blockKind: block.kind,
        promptLength: userPrompt?.length ?? 0,
        durationMs: Date.now() - startedAt,
        outputLength: finalText.length,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };

  // V1.7.2: auto-fire when the proactive KB chip set an intent prefill for
  // this block. We consume + clear the prefill in the same tick so React
  // strict-mode's double-mount doesn't fire the edit twice. `submit` is
  // intentionally not in the deps — it's recreated each render but only
  // reads stable store actions, so listing it would loop the effect.
  useEffect(() => {
    if (!intentPrefill) return;
    if (intentPrefill.blockId !== block.id) return;
    if (pendingEdit) return;
    setIntentPrefill(null);
    void submit(intentPrefill.intent);
  }, [intentPrefill, block.id, pendingEdit, setIntentPrefill, submit]);

  const onTextareaKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submit("freeform", prompt);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      selectBlock(null);
    }
  };

  const isPendingForThisBlock = Boolean(
    pendingEdit && pendingEdit.blockId === block.id,
  );
  const isRunning =
    isPendingForThisBlock && pendingEdit?.status === "running";
  const hasResult =
    isPendingForThisBlock && pendingEdit?.status === "complete";
  const hasError =
    isPendingForThisBlock && pendingEdit?.status === "error";

  const isEmpty = Boolean(
    hasResult && diffIsEmpty(beforeText, pendingEdit?.afterText ?? ""),
  );

  return (
    <div className="border-accent/40 bg-background mt-2 rounded-md border-2 px-3 py-3 shadow-sm">
      {kbHint && (
        <div className="text-muted-foreground mb-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] dark:bg-amber-950/20">
          <Bookmark className="mt-px h-3 w-3 shrink-0 text-amber-700 dark:text-amber-400" />
          <span className="leading-snug">
            <span className="font-medium text-amber-900 dark:text-amber-200">
              {kbHint.projectLabel}
            </span>{" "}
            — {kbHint.preview}
          </span>
        </div>
      )}
      {!isPendingForThisBlock && (
        <>
          <div className="mb-2 flex flex-wrap gap-1.5">
            <ChipButton
              icon={<Scissors className="h-3.5 w-3.5" />}
              label="Tighten"
              onClick={() => void submit("tighten")}
            />
            <ChipButton
              icon={<Pencil className="h-3.5 w-3.5" />}
              label="Match firm voice"
              onClick={() => void submit("match_voice")}
            />
            <ChipButton
              icon={<Bookmark className="h-3.5 w-3.5" />}
              label="Fix names"
              onClick={() => void submit("fix_names")}
            />
            <ChipButton
              icon={<RotateCw className="h-3.5 w-3.5" />}
              label="Reference past work"
              onClick={() => void submit("reference_past_work")}
              hint="Best on Project Approach / Relevant Experience blocks"
            />
          </div>
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            rows={2}
            placeholder="Or describe a change… e.g. Replace 'Alejandra Ricci' with 'John Smith'"
            className="border-border bg-muted/40 placeholder:text-muted-foreground/70 w-full resize-none rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          <div className="text-muted-foreground mt-2 flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => selectBlock(null)}
              className="hover:text-foreground"
            >
              <span className="rounded border px-1.5 py-0.5 font-mono text-[10px]">
                Esc
              </span>{" "}
              cancel
            </button>
            <button
              type="button"
              onClick={() => void submit("freeform", prompt)}
              disabled={!prompt.trim()}
              className="bg-accent text-accent-foreground inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CornerDownLeft className="h-3 w-3" />
              Send
              <span className="bg-black/20 ml-1 rounded px-1 py-0 font-mono text-[10px]">
                ⌘↵
              </span>
            </button>
          </div>
        </>
      )}

      {isRunning && (
        <div className="text-muted-foreground flex items-center gap-2 px-1 py-2 text-xs">
          <Loader2 className="text-accent h-4 w-4 animate-spin" />
          Generating proposed edit…
        </div>
      )}

      {hasError && (
        <div className="text-danger bg-red-50 px-3 py-2 text-xs dark:bg-red-950/30">
          <p className="mb-2 font-medium">Edit failed</p>
          <p>{pendingEdit.error}</p>
          <button
            type="button"
            onClick={() => clearEdit()}
            className="mt-2 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {hasResult && (
        <div className="space-y-2">
          <div className="border-border bg-muted/30 rounded px-3 py-2">
            {isEmpty ? (
              <p className="text-muted-foreground text-xs italic">
                Model returned no changes (no clearly relevant edit).
              </p>
            ) : (
              <DiffView
                before={beforeText}
                after={pendingEdit.afterText ?? ""}
              />
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => clearEdit()}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 px-2 py-1 text-xs"
            >
              <X className="h-3 w-3" />
              Discard
            </button>
            <button
              type="button"
              onClick={() => acceptEdit()}
              disabled={isEmpty}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium",
                isEmpty
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : "bg-success text-white hover:opacity-90",
              )}
            >
              Accept change
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChipButton({
  icon,
  label,
  onClick,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className="border-border hover:border-accent hover:bg-accent/5 inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition"
    >
      {icon}
      {label}
    </button>
  );
}
