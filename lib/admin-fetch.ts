// Shared fetch plumbing for the admin arrange surfaces (Wall and Shop).
//
// Extracted from WallArranger so ShopShelf can use the SAME timeout guarantee
// rather than inlining `AbortSignal.timeout?.(30_000)`, which silently drops the
// AbortController fallback and leaves a hung request able to wedge the shelf
// forever on any engine without AbortSignal.timeout.
//
// Browser-only in practice, but it imports nothing, so it is safe anywhere.

/**
 * Every mutation runs behind an in-flight gate so the interaction models can't
 * interleave. A hung request would wedge the page, so abort at 30s (server worst
 * case = 15s connect + 15s statement_timeout). A timed-out request MAY have
 * committed, so callers reconcile by reload rather than rolling back.
 *
 * AbortSignal.timeout is optional-chained for very old engines; fall back to a
 * real controller so the timeout guarantee is never silently dropped.
 */
export function mutationTimeout(): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(30_000);
  }
  if (typeof AbortController === 'undefined') return undefined;
  const c = new AbortController();
  setTimeout(() => c.abort(), 30_000);
  return c.signal;
}

export function isTimeout(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === 'TimeoutError' || err.name === 'AbortError')
  );
}

/**
 * `timedOut` is a separate flag, not a magic string in `error`: a server body of
 * {error:'timeout'} must not be mistaken for a client-side abort.
 */
export type MutResult = {
  ok: boolean;
  status: number;
  error?: string;
  timedOut?: boolean;
};
