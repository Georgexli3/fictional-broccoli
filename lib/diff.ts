/**
 * Diff utility — wraps diff-match-patch with word-level cleanup and React-
 * friendly output.
 *
 * Why diff-match-patch: battle-tested, tiny (~50KB), no React baggage.
 * Word-level cleanup makes diffs visually sensible — without it, single-
 * character edits in long words look like character soup.
 *
 * Why we compute diff client-side: tokens are cheap to send (we already have
 * the new text); a custom diff renderer is harder to do server-side without
 * shipping a JSX renderer over the wire.
 */

import DiffMatchPatch from "diff-match-patch";

export type DiffOpKind = "equal" | "insert" | "delete";

export interface DiffOp {
  kind: DiffOpKind;
  text: string;
}

const dmp = new DiffMatchPatch();

/**
 * Compute a clean word-level diff between two strings.
 *
 * Normalization:
 *   - Curly/straight quotes are unified (smart quotes → straight) so quote-
 *     style differences don't show as edits.
 *   - Whitespace is collapsed to single spaces (preserving paragraph breaks).
 */
export function computeDiff(before: string, after: string): DiffOp[] {
  const a = normalizeForDiff(before);
  const b = normalizeForDiff(after);
  if (a === b) return [{ kind: "equal", text: before }];

  const raw = dmp.diff_main(a, b);
  // Word-level + semantic cleanup makes the diff much more readable than the
  // raw character-level output.
  dmp.diff_cleanupSemantic(raw);

  return raw.map(([op, text]) => ({
    kind:
      op === DiffMatchPatch.DIFF_INSERT
        ? "insert"
        : op === DiffMatchPatch.DIFF_DELETE
          ? "delete"
          : "equal",
    text,
  }));
}

function normalizeForDiff(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–/g, "-")
    .replace(/—/g, "—")
    .replace(/ /g, " ");
}

/**
 * Quick boolean: are these two strings semantically the same after
 * normalization?
 */
export function diffIsEmpty(before: string, after: string): boolean {
  return normalizeForDiff(before) === normalizeForDiff(after);
}
