/**
 * Lightweight elapsed-time helpers for measurement-only instrumentation.
 * Does not change control flow; callers still await real work.
 */

export async function timedMs<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - t0 };
}

export function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

/** Wall-clock for a parallel Promise.all branch — do not sum these for total. */
export async function timedSettleMs<T>(
  fn: () => Promise<T>
): Promise<{ value: T; ms: number; error: string | null }> {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { value, ms: Date.now() - t0, error: null };
  } catch (e) {
    return {
      value: undefined as unknown as T,
      ms: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e)
    };
  }
}
