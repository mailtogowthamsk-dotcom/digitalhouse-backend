/**
 * MYSQL pool instrumentation (temporary).
 *
 * Enable:  DB_POOL_DEBUG=true
 * Disable: unset DB_POOL_DEBUG (or set to anything other than "true")
 *
 * Log prefix: [MYSQL_POOL]
 */
import type { Sequelize } from "sequelize";

export type PoolSnapshot = {
  size: number;
  available: number;
  using: number;
  waiting: number;
  max: number;
  min: number;
};

type PoolLike = {
  size: number;
  available: number;
  using: number;
  waiting: number;
  maxSize: number;
  minSize: number;
  acquire: (...args: unknown[]) => Promise<unknown>;
  release: (resource: unknown) => void;
  destroy: (resource: unknown) => void;
};

let installed = false;
let peakUsing = 0;
let peakWaiting = 0;
let acquireCount = 0;
let releaseCount = 0;
let createCount = 0;
let destroyCount = 0;
let timeoutCount = 0;
let reuseCount = 0;

function readPool(sequelize: Sequelize): PoolLike | null {
  const pool = (sequelize.connectionManager as { pool?: PoolLike } | undefined)?.pool;
  return pool ?? null;
}

export function getPoolSnapshot(sequelize: Sequelize): PoolSnapshot | null {
  const pool = readPool(sequelize);
  if (!pool) return null;
  return {
    size: pool.size,
    available: pool.available,
    using: pool.using,
    waiting: pool.waiting,
    max: pool.maxSize,
    min: pool.minSize
  };
}

export function getPoolDebugCounters() {
  return {
    acquireCount,
    releaseCount,
    createCount,
    destroyCount,
    reuseCount,
    timeoutCount,
    peakUsing,
    peakWaiting
  };
}

function isDebugEnabled(): boolean {
  return process.env.DB_POOL_DEBUG === "true";
}

function logLine(message: string): void {
  if (!isDebugEnabled()) return;
  console.log(`[MYSQL_POOL] ${message}`);
}

function logSnapshot(label: string, sequelize: Sequelize, extra?: string): void {
  const snap = getPoolSnapshot(sequelize);
  if (!snap) {
    logLine(label);
    return;
  }
  const bits = [
    label,
    `Pool Active: ${snap.using}`,
    `Pool Waiting: ${snap.waiting}`,
    `Pool Available: ${snap.available}`,
    `Pool Size: ${snap.size}/${snap.max}`
  ];
  if (extra) bits.push(extra);
  logLine(bits.join(" | "));
}

/**
 * Patch pool acquire/release/destroy once. Call after authenticate (pool exists).
 */
export function installPoolDebug(sequelize: Sequelize): void {
  if (installed) return;
  if (!isDebugEnabled()) return;

  const pool = readPool(sequelize);
  if (!pool || typeof pool.acquire !== "function") {
    console.warn("[MYSQL_POOL] debug requested but pool not ready yet");
    return;
  }

  installed = true;
  const origAcquire = pool.acquire.bind(pool);
  const origRelease = pool.release.bind(pool);
  const origDestroy = pool.destroy.bind(pool);
  const sizeBeforePatch = pool.size;

  pool.acquire = async (...args: unknown[]) => {
    const waitingBefore = pool.waiting;
    if (waitingBefore > 0) {
      peakWaiting = Math.max(peakWaiting, waitingBefore + 1);
      logSnapshot("Waiting for connection", sequelize, `Queue ahead: ${waitingBefore}`);
    }
    const started = Date.now();
    const availableBefore = pool.available;
    try {
      const conn = await origAcquire(...args);
      const waitMs = Date.now() - started;
      acquireCount += 1;
      peakUsing = Math.max(peakUsing, pool.using);
      if (availableBefore > 0) {
        reuseCount += 1;
        logLine(`Connection reused | Acquire Time: ${waitMs}ms`);
      } else {
        createCount += 1;
        logLine(`Connection created (or first use) | Acquire Time: ${waitMs}ms`);
      }
      logLine("Connection acquired");
      logSnapshot("Pool status", sequelize, `Acquire Time: ${waitMs}ms`);
      return conn;
    } catch (err) {
      timeoutCount += 1;
      const waitMs = Date.now() - started;
      logLine(
        `Acquire timeout | Acquire Time: ${waitMs}ms | ${err instanceof Error ? err.message : String(err)}`
      );
      logSnapshot("Pool status after timeout", sequelize);
      throw err;
    }
  };

  pool.release = (resource: unknown) => {
    releaseCount += 1;
    origRelease(resource);
    logLine("Connection released");
    logSnapshot("Pool status", sequelize);
  };

  pool.destroy = (resource: unknown) => {
    destroyCount += 1;
    logLine("Connection destroyed");
    origDestroy(resource);
    logSnapshot("Pool status", sequelize);
  };

  // Wrap managed transactions for commit/rollback visibility (no behavior change).
  const origTransaction = sequelize.transaction.bind(sequelize);
  (sequelize as unknown as { transaction: typeof sequelize.transaction }).transaction = ((
    ...args: unknown[]
  ) => {
    logLine("Transaction Started");
    const started = Date.now();
    const result = (origTransaction as (...a: unknown[]) => Promise<unknown> | unknown)(...args);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      return (result as Promise<unknown>).then(
        (value) => {
          logLine(`Transaction Committed | Duration: ${Date.now() - started}ms`);
          return value;
        },
        (err) => {
          logLine(`Transaction Rolled Back | Duration: ${Date.now() - started}ms`);
          throw err;
        }
      );
    }
    return result;
  }) as typeof sequelize.transaction;

  // Optional: log query timings when pool debug is on (in addition to DB_SLOW_QUERY_MS).
  const seqAny = sequelize as unknown as {
    options: { logging?: boolean | ((sql: string, timing?: number) => void); benchmark?: boolean };
  };
  const prevLogging = seqAny.options.logging;
  seqAny.options.benchmark = true;
  seqAny.options.logging = (sql: string, timing?: number) => {
    if (typeof prevLogging === "function") {
      prevLogging(sql, timing);
    }
    if (typeof timing === "number") {
      const truncated = sql.length > 180 ? `${sql.slice(0, 180)}…` : sql;
      logLine(`Query Time: ${timing}ms | ${truncated}`);
    }
  };

  console.log(
    `[MYSQL_POOL] debug instrumentation enabled (DB_POOL_DEBUG=true) | initial size=${sizeBeforePatch}`
  );

  const intervalMs = Math.max(5000, Number(process.env.DB_POOL_DEBUG_INTERVAL_MS || 15000));
  setInterval(() => {
    logSnapshot("Heartbeat", sequelize);
  }, intervalMs).unref?.();
}
