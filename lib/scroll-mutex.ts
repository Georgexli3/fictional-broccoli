/**
 * Programmatic-scroll mutex (Patterns A + B from the V1.5 plan).
 *
 * Multiple hooks call `scrollTo({ behavior: "smooth" })` on the PDF and Doc
 * scroll containers — `usePaneScrollSync` (bidirectional), `usePdfHoverScroll`
 * (block-hover → PDF), and any future "scroll into view" call sites. Without
 * coordination they fight: one hook's smooth-scroll triggers the other's
 * IntersectionObserver, which fires a counter-scroll, which retriggers the
 * first hook → ping-pong.
 *
 * This module owns a single module-scope flag (`isProgrammatic`). Both hooks
 * acquire it via `runProgrammaticScroll`, release on the browser's `scrollend`
 * event when supported (Chromium 114+, Safari 18.2+, Firefox 122+) or on a
 * 1000 ms timeout fallback. IO callbacks early-return when the flag is set.
 *
 * Not React. No state, no re-renders. Just a flag.
 */

type Holder = "sync" | "hover" | null;

let holder: Holder = null;

/**
 * True iff a programmatic scroll is in flight. IO callbacks should early-return
 * when this is true to avoid feedback loops.
 */
export function isProgrammaticScroll(): boolean {
  return holder !== null;
}

/**
 * Drive a smooth scroll under the mutex. If another hook already holds the
 * mutex, the call is a no-op (their scroll wins; we don't fight them).
 *
 * The mutex is released on `scrollend` (real settle) or after 1000 ms,
 * whichever comes first. The timeout is the universal fallback — iOS smooth
 * scroll can take >600 ms for long jumps, and not every browser ships
 * `scrollend` yet.
 *
 * @param who Identifies the calling hook for diagnostics + to allow the same
 *   hook to re-acquire mid-scroll without blocking itself.
 * @param container The scroll container that's being scrolled.
 * @param top Target `scrollTop` in container px.
 */
export function runProgrammaticScroll(
  who: "sync" | "hover",
  container: HTMLElement,
  top: number,
): void {
  // Same holder re-entering: just update the target (e.g. user moved hover).
  if (holder !== null && holder !== who) return;

  holder = who;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    container.removeEventListener("scrollend", release);
    clearTimeout(safety);
    if (holder === who) holder = null;
  };

  container.addEventListener("scrollend", release, { once: true });
  const safety = setTimeout(release, 1000);

  container.scrollTo({ top, behavior: "smooth" });
}

/**
 * Test-only: forcibly clear the mutex. Don't use in app code.
 */
export function __resetScrollMutexForTests(): void {
  holder = null;
}
