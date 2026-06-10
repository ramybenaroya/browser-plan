/**
 * Per-session in-process write lock. This is a single Node process, but request
 * handlers interleave at every `await`, so two concurrent ops on the same
 * session could each read `session.json`, mutate their own copy, and clobber the
 * other's index update on write-back. A promise-chain mutex per session id
 * serializes those read-modify-write critical sections.
 *
 * Scope is deliberately in-process only: no cross-process file locks, no fsync.
 */
const chains = new Map<string, Promise<unknown>>();

/** Run `fn` after any in-flight op for `sessionId` settles; serialize per id. */
export function withSessionLock<T>(
  sessionId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = chains.get(sessionId) ?? Promise.resolve();
  // Chain regardless of whether prev resolved or rejected so one failure does
  // not wedge the queue.
  const next = prev.then(fn, fn);
  // The stored tail must never reject (it would surface as an unhandled
  // rejection on a later `.then`); callers get the real result via `next`.
  chains.set(sessionId, next.catch(() => {}));
  return next;
}
