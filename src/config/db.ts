import { Sequelize } from "sequelize";
import "../config/env";
import { getPoolSnapshot, installPoolDebug } from "./dbPoolMonitor";

/**
 * Shared-hosting safe defaults.
 * Override with DB_POOL_PROFILE=test|prod16|prod64 or explicit DB_POOL_MAX.
 *
 * See docs/MYSQL_CONNECTION_SATURATION_AUDIT.md for sizing rationale.
 */
function resolvePoolMax(): number {
  const explicit = Number(process.env.DB_POOL_MAX);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.min(64, Math.max(1, Math.floor(explicit)));
  }
  const profile = (process.env.DB_POOL_PROFILE || "").toLowerCase();
  if (profile === "prod64") return 24;
  if (profile === "prod16") return 12;
  if (profile === "test" || profile === "1gb") return 3;
  // Shared cPanel / unknown: stay small — Max_used_connections already hit 152.
  return 4;
}

const poolMax = resolvePoolMax();
const connectTimeout = Math.max(5000, Number(process.env.DB_CONNECT_TIMEOUT_MS || 20000));
const slowQueryMs = Math.max(0, Number(process.env.DB_SLOW_QUERY_MS ?? 500));
/** MySQL session idle kill (seconds). Caps orphaned Sleep after process crash. */
const sessionWaitTimeout = Math.max(60, Number(process.env.DB_SESSION_WAIT_TIMEOUT || 120));
const poolIdleMs = Math.max(2000, Number(process.env.DB_POOL_IDLE_MS || 8000));
const poolEvictMs = Math.max(1000, Number(process.env.DB_POOL_EVICT_MS || 5000));
/** Recycle connections after N uses — reduces stuck / half-open sockets. */
const poolMaxUses = Math.max(0, Number(process.env.DB_POOL_MAX_USES || 750));

function sequelizeLogging(sql: string, timing?: number): void {
  if (slowQueryMs <= 0) return;
  const ms = typeof timing === "number" ? timing : undefined;
  if (ms == null || ms < slowQueryMs) return;
  const truncated = sql.length > 500 ? `${sql.slice(0, 500)}…` : sql;
  console.warn(`[slow-query] ${ms}ms ${truncated}`);
}

/**
 * SINGLETON — do not `new Sequelize()` elsewhere in the app runtime.
 * Scripts may use one-off mysql2 connections; they must call connection.end().
 */
export const sequelize = new Sequelize(
  process.env.DB_NAME as string,
  process.env.DB_USER as string,
  process.env.DB_PASSWORD as string,
  {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    dialect: "mysql",
    benchmark: slowQueryMs > 0,
    logging: slowQueryMs > 0 ? sequelizeLogging : false,
    dialectOptions: {
      connectTimeout,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000
    },
    pool: {
      max: poolMax,
      min: 0,
      acquire: Math.max(20000, Math.min(45000, connectTimeout + 10000)),
      idle: poolIdleMs,
      evict: poolEvictMs,
      ...(poolMaxUses > 0 ? { maxUses: poolMaxUses } : {})
    },
    hooks: {
      afterConnect: async (connection: unknown) => {
        try {
          const conn = connection as {
            promise?: () => { query: (sql: string) => Promise<unknown> };
            query: Function;
          };
          const sql = `SET SESSION wait_timeout=${sessionWaitTimeout}, interactive_timeout=${sessionWaitTimeout}`;
          if (typeof conn.promise === "function") {
            await conn.promise().query(sql);
          } else {
            await new Promise<void>((resolve, reject) => {
              conn.query(sql, (err: Error | null) => (err ? reject(err) : resolve()));
            });
          }
        } catch {
          /* shared hosts may forbid SESSION vars */
        }
      }
    },
    retry: {
      // Do NOT retry "Too many connections" — that amplifies connection storms.
      max: 2,
      match: [
        /ETIMEDOUT/i,
        /ECONNRESET/i,
        /ECONNREFUSED/i,
        /SequelizeConnectionError/i,
        /SequelizeConnectionRefusedError/i,
        /SequelizeHostNotFoundError/i,
        /SequelizeConnectionTimedOutError/i,
        /Deadlock/i,
        /Lock wait timeout/i
      ]
    }
  }
);

/** Call once after first successful authenticate so the pool exists. */
export function initDbPoolInstrumentation(): void {
  installPoolDebug(sequelize);
  const snap = getPoolSnapshot(sequelize);
  console.log(
    `[MYSQL_POOL] configured max=${poolMax} idleMs=${poolIdleMs} sessionWaitTimeout=${sessionWaitTimeout}s` +
      (snap ? ` snapshot=${JSON.stringify(snap)}` : "")
  );
}

export function getDbPoolSnapshot() {
  return getPoolSnapshot(sequelize);
}

export const DB_POOL_CONFIG = {
  max: poolMax,
  idleMs: poolIdleMs,
  evictMs: poolEvictMs,
  maxUses: poolMaxUses,
  sessionWaitTimeout,
  profile: process.env.DB_POOL_PROFILE || "default"
} as const;
