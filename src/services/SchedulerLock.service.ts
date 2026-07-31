/**
 * Cross-process job locks via MySQL GET_LOCK.
 * Holds a dedicated pool connection for the duration of the job so the lock stays valid.
 * Safe with multiple scheduler worker instances — only one holder runs the job body.
 */
import { sequelize } from "../config/db";

function lockNameFor(jobKey: string): string {
  return `dh_sched_${jobKey}`.slice(0, 64);
}

function readAcquired(queryResult: unknown): boolean {
  // mysql2: connection.query → [rows, fields]; rows[0].acquired
  const rows = Array.isArray(queryResult)
    ? Array.isArray(queryResult[0])
      ? (queryResult[0] as Array<Record<string, unknown>>)
      : (queryResult as Array<Record<string, unknown>>)
    : [];
  const row = rows[0];
  if (!row) return false;
  const v = row.acquired ?? row.ACQUIRED ?? Object.values(row)[0];
  return Number(v) === 1;
}

export type LockResult<T> =
  | { acquired: true; result: T }
  | { acquired: false; result?: undefined };

type PoolConnection = {
  query: (sql: string, values?: unknown[]) => Promise<unknown>;
};

/**
 * Non-blocking lock. If another process holds the lock, returns acquired:false immediately.
 */
export async function withSchedulerLock<T>(
  jobKey: string,
  work: () => Promise<T>
): Promise<LockResult<T>> {
  const name = lockNameFor(jobKey);
  const cm = sequelize.connectionManager as unknown as {
    getConnection: (opts: { type: string }) => Promise<PoolConnection>;
    releaseConnection: (conn: PoolConnection) => void;
  };

  const connection = await cm.getConnection({ type: "write" });
  try {
    const got = await connection.query("SELECT GET_LOCK(?, 0) AS acquired", [name]);
    if (!readAcquired(got)) {
      return { acquired: false };
    }
    try {
      const result = await work();
      return { acquired: true, result };
    } finally {
      try {
        await connection.query("SELECT RELEASE_LOCK(?) AS released", [name]);
      } catch (err) {
        console.warn(
          `[scheduler-lock] RELEASE_LOCK failed for ${jobKey}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  } finally {
    cm.releaseConnection(connection);
  }
}
