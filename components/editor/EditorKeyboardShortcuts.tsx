"use client";

import { useEffect } from "react";

import { useSessionStore } from "@/lib/session-store";
import { track } from "@/lib/track";

/**
 * Global keyboard shortcuts for the editor.
 *
 * - ⌘Z / Ctrl+Z: undo last accepted edit
 * - ⌘⇧Z / Ctrl+Shift+Z: redo
 * - Escape (when no input focused): deselect block
 *
 * Mounted as an invisible component inside EditorBoot.
 */
export function EditorKeyboardShortcuts() {
  const undo = useSessionStore((s) => s.undo);
  const redo = useSessionStore((s) => s.redo);
  const selectBlock = useSessionStore((s) => s.selectBlock);
  const pendingEdit = useSessionStore((s) => s.pendingEdit);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      const meta = event.metaKey || event.ctrlKey;

      if (meta && (event.key === "z" || event.key === "Z")) {
        // Don't intercept if user is typing in textarea — they expect normal undo.
        // Exception: if they're typing in our edit composer, still let our app
        // handle global undo. The composer textarea uses its own undo for text,
        // but for accepted-edit revert we want app-level undo. We choose to
        // ALWAYS do app-level undo on ⌘Z to keep the demo predictable.
        // (User can use textarea's right-click menu for textarea-local undo.)
        event.preventDefault();
        if (event.shiftKey) {
          redo();
          track({ name: "edit_redone" });
        } else {
          undo();
          track({ name: "edit_undone" });
        }
        return;
      }

      if (event.key === "Escape" && !isTyping && !pendingEdit) {
        selectBlock(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, selectBlock, pendingEdit]);

  return null;
}
