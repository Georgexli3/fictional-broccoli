/**
 * Schema-versioned localStorage codec for session state.
 *
 * Why localStorage: Single-user V1; a DB is overkill at this scope. Refresh
 * resilience matters (the user might invest 20 minutes in edits before
 * accidentally hitting reload), so we persist the working doc + edit history
 * here. The PDF binary itself stays in Vercel Blob; we only persist its URL.
 *
 * Why versioned: schemas evolve. Bumping `SESSION_SCHEMA_VERSION` and adding
 * a migration is far cheaper than discovering at runtime that a half-decoded
 * old session crashed the editor.
 *
 * Quota note: localStorage is ~5MB per origin. A parsed doc model is small
 * (paragraphs are text), but very long sessions with deep history can grow.
 * The writer is debounced (250ms) so we don't thrash; the doc-model module
 * is responsible for keeping history bounded.
 */

import type { DocumentModel, EditHistoryItem } from "./doc-model";

export const SESSION_SCHEMA_VERSION = 1 as const;
const STORAGE_KEY = "buoyant.session.v1";

export interface SessionState {
  version: typeof SESSION_SCHEMA_VERSION;
  pdfBlobUrl: string;
  pdfHash: string;
  filename: string;
  size: number;
  uploadedAt: number;
  // Populated after milestone 4 (parse).
  doc?: DocumentModel;
  // Populated after milestone 5 (first accepted edit).
  history?: EditHistoryItem[];
  redoStack?: EditHistoryItem[];
}

export type SessionMeta = Pick<
  SessionState,
  "pdfBlobUrl" | "pdfHash" | "filename" | "size" | "uploadedAt"
>;

/**
 * Read the active session if any. Returns null if no session is stored or
 * the stored data is unreadable (corrupt, wrong version, etc.).
 *
 * SSR-safe: returns null on the server.
 */
export function readSession(): SessionState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionState;
    if (parsed.version !== SESSION_SCHEMA_VERSION) {
      // Future migrations would go here. For V1 we just discard.
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Synchronously persist the full session. Use the debounced writer
 * `scheduleSessionWrite` for the hot path; use this for boundary moments
 * (initial create, before navigation) where you want the write to happen
 * before the next tick.
 */
export function writeSession(state: SessionState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    // Likely quota exceeded. The caller surfaces this; we don't crash.
    console.warn("[persistence] failed to write session:", error);
    throw error;
  }
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

/**
 * Initialize a new session from upload metadata. Wipes any prior session
 * (V1 = single doc at a time).
 */
export function startSession(meta: SessionMeta): SessionState {
  const state: SessionState = {
    version: SESSION_SCHEMA_VERSION,
    ...meta,
  };
  writeSession(state);
  return state;
}

/**
 * Debounced writer. Use during hot edit/typing paths.
 */
let pendingWriteTimer: ReturnType<typeof setTimeout> | null = null;
let pendingState: SessionState | null = null;

export function scheduleSessionWrite(state: SessionState, delayMs = 250): void {
  pendingState = state;
  if (pendingWriteTimer) return;
  pendingWriteTimer = setTimeout(() => {
    if (pendingState) {
      try {
        writeSession(pendingState);
      } catch {
        // Already warned in writeSession.
      }
    }
    pendingWriteTimer = null;
    pendingState = null;
  }, delayMs);
}

/**
 * Force-flush a pending debounced write. Call before navigation.
 */
export function flushSessionWrite(): void {
  if (pendingWriteTimer) {
    clearTimeout(pendingWriteTimer);
    pendingWriteTimer = null;
  }
  if (pendingState) {
    try {
      writeSession(pendingState);
    } catch {
      // Already warned.
    }
    pendingState = null;
  }
}
