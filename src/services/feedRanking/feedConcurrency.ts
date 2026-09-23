/**
 * Request-local concurrency limiter for personalized feed DB work.
 * With DB_POOL_MAX=3, unbounded Promise.all of 5–6 queries mostly creates
 * pool waiting; staging at 2 leaves headroom for overlapping requests
 * (/auth/me, /legal/status, ads) without changing query results.
 */

export type AsyncTask<T> = () => Promise<T>;

/**
 * Run async tasks with a max in-flight limit. Results preserve input order.
 * Failed tasks reject the returned promise (same as Promise.all).
 */
export async function mapWithConcurrency<T>(
  tasks: Array<AsyncTask<T>>,
  limit: number
): Promise<T[]> {
  if (tasks.length === 0) return [];
  const max = Math.max(1, Math.min(limit, tasks.length));
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]!();
    }
  }

  const workers = Array.from({ length: max }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Like Promise.allSettled but with a concurrency cap. Order preserved.
 */
export async function allSettledWithConcurrency<T>(
  tasks: Array<AsyncTask<T>>,
  limit: number
): Promise<Array<PromiseSettledResult<T>>> {
  if (tasks.length === 0) return [];
  const max = Math.max(1, Math.min(limit, tasks.length));
  const results: Array<PromiseSettledResult<T>> = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= tasks.length) return;
      try {
        const value = await tasks[i]!();
        results[i] = { status: "fulfilled", value };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from({ length: max }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Default candidate-source concurrency under pool max=3. Override via env for experiments. */
export function feedCandidateConcurrency(): number {
  const raw = Number(process.env.FEED_CANDIDATE_CONCURRENCY);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 5) return Math.floor(raw);
  // Default 3 matches DB_POOL_MAX — fills the pool without nesting interest's 2-query branch.
  // Set FEED_CANDIDATE_CONCURRENCY=2 to leave headroom for overlapping /auth/me + /legal (P4E territory).
  return 3;
}
