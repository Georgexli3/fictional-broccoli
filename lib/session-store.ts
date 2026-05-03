/**
 * Session store — single source of truth for the editor's runtime state.
 *
 * Lives in the browser. Persists itself to localStorage (debounced) on every
 * change so a hard refresh resumes cleanly.
 *
 * Why Zustand: small, no boilerplate, integrates with React without context
 * gymnastics. The mutable doc-model operations live in `lib/doc-model.ts`;
 * this store wires them to React.
 */

import { nanoid } from "nanoid";
import { create } from "zustand";

import {
  currentText,
  type Block,
  type DocumentModel,
  type EditHistoryItem,
  type EditIntent,
} from "./doc-model";
import type { KbMatch } from "./kb-match";
import {
  flushSessionWrite,
  readSession,
  scheduleSessionWrite,
  type SessionState,
} from "./persistence";

interface PendingEdit {
  blockId: string;
  intent: EditIntent;
  userPrompt?: string;
  status: "running" | "complete" | "error";
  afterText?: string;
  error?: string;
  startedAt: number;
}

interface SessionStore {
  /** Set on hydration once the localStorage session is loaded. */
  meta:
    | (Pick<
        SessionState,
        "pdfBlobUrl" | "pdfHash" | "filename" | "size" | "uploadedAt"
      > & {
        ready: true;
      })
    | { ready: false };
  doc: DocumentModel | null;
  selectedBlockId: string | null;
  /** Span text captured from the user's selection when they clicked the block. */
  selectionPrefill: string | null;
  /** Block currently hovered on the right pane (used by PdfPane to scroll). */
  hoveredBlockId: string | null;
  /**
   * Block currently in the middle band of the DocPane viewport. Set by
   * `useActiveBlockTracking`. Distinct from `selectedBlockId` (clicked-to-edit)
   * — this is viewport reality, used by `ChangesPanel` to auto-focus the
   * relevant entry. EPHEMERAL.
   */
  activeBlockId: string | null;
  /**
   * V1.7.2: proactive KB hints, keyed by block ID. Populated once after
   * doc load by POSTing blocks to /api/kb-match. Empty if the KB hasn't
   * been built or no blocks matched. EPHEMERAL.
   */
  kbHints: Record<string, KbMatch>;
  /**
   * V1.7.2: when set, the EditComposer for `blockId` auto-fires `intent` on
   * mount. Used by the proactive 📎 KB chip — clicking it should kick off a
   * "reference past work" edit immediately, not require the user to click
   * the same intent inside the composer. Cleared after auto-fire. EPHEMERAL.
   */
  intentPrefill: { blockId: string; intent: EditIntent } | null;
  pendingEdit: PendingEdit | null;

  // Actions
  hydrate: (hash: string) => boolean;
  setDoc: (doc: DocumentModel) => void;
  updateBlockBboxes: (
    updates: Array<{
      blockId: string;
      page: number;
      x: number;
      y: number;
      w: number;
      h: number;
      confidence: number;
    }>,
  ) => void;
  selectBlock: (blockId: string | null, prefill?: string | null) => void;
  setHoveredBlock: (blockId: string | null) => void;
  /** Viewport-reality block tracking. */
  setActiveBlockId: (blockId: string | null) => void;
  /** V1.7.2: replace the KB hints map. */
  setKbHints: (hints: Record<string, KbMatch>) => void;
  /** V1.7.2: schedule an auto-fired edit on the given block. */
  setIntentPrefill: (
    prefill: { blockId: string; intent: EditIntent } | null,
  ) => void;
  startPendingEdit: (input: {
    blockId: string;
    intent: EditIntent;
    userPrompt?: string;
  }) => void;
  setPendingEditResult: (afterText: string) => void;
  setPendingEditError: (error: string) => void;
  clearPendingEdit: () => void;
  acceptPendingEdit: () => void;
  undo: () => void;
  redo: () => void;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  meta: { ready: false },
  doc: null,
  selectedBlockId: null,
  selectionPrefill: null,
  hoveredBlockId: null,
  activeBlockId: null,
  kbHints: {},
  intentPrefill: null,
  pendingEdit: null,

  hydrate(hash) {
    const stored = readSession();
    if (!stored || stored.pdfHash !== hash) {
      return false;
    }
    set({
      meta: {
        ready: true,
        pdfBlobUrl: stored.pdfBlobUrl,
        pdfHash: stored.pdfHash,
        filename: stored.filename,
        size: stored.size,
        uploadedAt: stored.uploadedAt,
      },
      doc: stored.doc ?? null,
    });
    return true;
  },

  setDoc(doc) {
    set({ doc });
    persist(get());
  },

  updateBlockBboxes(updates) {
    const { doc } = get();
    if (!doc) return;
    const updateMap = new Map(updates.map((u) => [u.blockId, u]));
    const newDoc: DocumentModel = {
      ...doc,
      blocks: doc.blocks.map((b) => {
        const u = updateMap.get(b.id);
        if (!u) return b;
        return {
          ...b,
          bboxResolved: {
            page: u.page,
            x: u.x,
            y: u.y,
            w: u.w,
            h: u.h,
            confidence: u.confidence,
          },
        };
      }),
    };
    set({ doc: newDoc });
    persist(get());
  },

  selectBlock(blockId, prefill = null) {
    // Set activeBlockId in the same update so the drawer's auto-focus doesn't
    // briefly land on a transient viewport block during the smooth-scroll
    // that follows a click.
    set({
      selectedBlockId: blockId,
      selectionPrefill: blockId ? prefill : null,
      pendingEdit: null,
      activeBlockId: blockId ?? get().activeBlockId,
    });
  },

  setHoveredBlock(blockId) {
    set({ hoveredBlockId: blockId });
  },

  setActiveBlockId(blockId) {
    set({ activeBlockId: blockId });
  },

  setKbHints(hints) {
    set({ kbHints: hints });
  },

  setIntentPrefill(prefill) {
    set({ intentPrefill: prefill });
  },

  startPendingEdit({ blockId, intent, userPrompt }) {
    set({
      pendingEdit: {
        blockId,
        intent,
        userPrompt,
        status: "running",
        startedAt: Date.now(),
      },
    });
  },

  setPendingEditResult(afterText) {
    set((state) => {
      if (!state.pendingEdit) return state;
      return {
        pendingEdit: {
          ...state.pendingEdit,
          status: "complete",
          afterText,
        },
      };
    });
  },

  setPendingEditError(error) {
    set((state) => {
      if (!state.pendingEdit) return state;
      return {
        pendingEdit: { ...state.pendingEdit, status: "error", error },
      };
    });
  },

  clearPendingEdit() {
    set({ pendingEdit: null });
  },

  acceptPendingEdit() {
    const { doc, pendingEdit } = get();
    if (!doc || !pendingEdit || pendingEdit.status !== "complete") return;
    if (typeof pendingEdit.afterText !== "string") return;

    const block = doc.blocks.find((b) => b.id === pendingEdit.blockId);
    if (!block) return;
    const beforeText = currentText(block);

    const editId = nanoid(10);
    const now = Date.now();
    const historyItem: EditHistoryItem = {
      id: editId,
      blockId: block.id,
      intent: pendingEdit.intent,
      userPrompt: pendingEdit.userPrompt,
      status: "accepted",
      beforeText,
      afterText: pendingEdit.afterText,
      createdAt: now,
    };

    const newDoc: DocumentModel = {
      ...doc,
      blocks: doc.blocks.map((b) =>
        b.id === block.id
          ? {
              ...b,
              revisions: [
                ...b.revisions,
                {
                  text: pendingEdit.afterText!,
                  source: "edit" as const,
                  editId,
                  createdAt: now,
                },
              ],
            }
          : b,
      ),
      history: [...doc.history, historyItem],
      redoStack: [],
    };

    set({ doc: newDoc, pendingEdit: null });
    persist(get());
  },

  undo() {
    const { doc } = get();
    if (!doc) return;
    const last = doc.history[doc.history.length - 1];
    if (!last) return;
    const block = doc.blocks.find((b) => b.id === last.blockId);
    if (!block) return;
    if (block.revisions.length <= 1) return; // can't drop below original

    const newDoc: DocumentModel = {
      ...doc,
      blocks: doc.blocks.map((b) =>
        b.id === block.id
          ? { ...b, revisions: b.revisions.slice(0, -1) }
          : b,
      ),
      history: doc.history.slice(0, -1),
      redoStack: [...doc.redoStack, last],
    };

    set({ doc: newDoc });
    persist(get());
  },

  redo() {
    const { doc } = get();
    if (!doc) return;
    const top = doc.redoStack[doc.redoStack.length - 1];
    if (!top) return;
    const block = doc.blocks.find((b) => b.id === top.blockId);
    if (!block) return;

    const now = Date.now();
    const newDoc: DocumentModel = {
      ...doc,
      blocks: doc.blocks.map((b) =>
        b.id === block.id
          ? {
              ...b,
              revisions: [
                ...b.revisions,
                {
                  text: top.afterText,
                  source: "edit" as const,
                  editId: top.id,
                  createdAt: now,
                },
              ],
            }
          : b,
      ),
      history: [...doc.history, top],
      redoStack: doc.redoStack.slice(0, -1),
    };

    set({ doc: newDoc });
    persist(get());
  },
}));

/**
 * Persist the current store state to localStorage. Debounced (250ms) so we
 * don't thrash on rapid edits. Called from every mutation that should be
 * durable across refresh.
 */
function persist(state: SessionStore) {
  if (!state.meta.ready) return;
  const serialized: SessionState = {
    version: 1,
    pdfBlobUrl: state.meta.pdfBlobUrl,
    pdfHash: state.meta.pdfHash,
    filename: state.meta.filename,
    size: state.meta.size,
    uploadedAt: state.meta.uploadedAt,
    doc: state.doc ?? undefined,
  };
  scheduleSessionWrite(serialized);
}

/** Force-flush a pending debounced write. Call before navigation. */
export function flushSession() {
  flushSessionWrite();
}

/** Helper: get the currently selected block, if any. */
export function useSelectedBlock(): Block | null {
  const doc = useSessionStore((s) => s.doc);
  const selectedBlockId = useSessionStore((s) => s.selectedBlockId);
  if (!doc || !selectedBlockId) return null;
  return doc.blocks.find((b) => b.id === selectedBlockId) ?? null;
}

