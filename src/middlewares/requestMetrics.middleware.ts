/**
 * Request timing + optional [api-metrics] logging.
 *
 * Always:
 *   - Assigns / propagates X-Request-Id
 *   - Logs [slow-api] when duration >= SLOW_API_MS (default 800)
 *   - Logs [request-correlate] for slow OR status >= 400 (ops correlation; no bodies/tokens)
 *
 * When API_METRICS=1:
 *   - Logs [api-metrics] JSON for allowlisted cold-start routes
 *     (or API_METRICS_ROUTES=* for all)
 *
 * Correlation boundary (Phase 3Q):
 *   - API wall time = middleware duration (HTTP in → response finish)
 *   - Pool acquire wait = DB_POOL_DEBUG samples (process-wide, not perfect per-SQL)
 *   - SQL time = [slow-query] fingerprints sharing requestId when ALS context held
 *   - Service stages = [home-metrics]/[feed-metrics]/[media-metrics] with same requestId
 *   - Does NOT decompose every SQL under a request without a global Sequelize wrapper
 *
 * Does not alter JSON response bodies.
 * Does not log bodies, tokens, cookies, or message content.
 */

import type { Request, Response, NextFunction } from "express";
import {
  getOrCreateRequestId,
  getSlowApiThresholdMs,
  isApiMetricsEnabled,
  logApiMetric,
  normalizeMetricRoute,
  parseApiMetricsRouteAllowlist,
  shouldEmitApiMetric,
  shouldIncludeUserIdInMetrics
} from "../utils/requestTiming";
import { runWithRequestContext } from "../utils/requestContext";
import { getDbPoolSnapshot, DB_POOL_CONFIG } from "../config/db";
import { getPoolDebugCounters } from "../config/dbPoolMonitor";

type AuthedRequest = Request & {
  requestId?: string;
  user?: { id?: number };
};

let allowlistCache: { at: number; value: ReturnType<typeof parseApiMetricsRouteAllowlist> } | null =
  null;

function getAllowlist() {
  const now = Date.now();
  if (allowlistCache && now - allowlistCache.at < 15_000) return allowlistCache.value;
  const value = parseApiMetricsRouteAllowlist();
  allowlistCache = { at: now, value };
  return value;
}

function maybePoolSnapshot():
  | {
      using: number;
      waiting: number;
      available: number;
      size: number;
      max: number;
      acquireWaitP50Ms?: number | null;
      acquireWaitP95Ms?: number | null;
      acquireWaitMaxMs?: number | null;
    }
  | undefined {
  try {
    const snap = getDbPoolSnapshot();
    if (!snap) return undefined;
    const counters =
      process.env.DB_POOL_DEBUG === "true" ? getPoolDebugCounters() : null;
    return {
      using: snap.using,
      waiting: snap.waiting,
      available: snap.available,
      size: snap.size,
      max: snap.max ?? DB_POOL_CONFIG.max,
      ...(counters
        ? {
            acquireWaitP50Ms: counters.acquireWaitP50Ms,
            acquireWaitP95Ms: counters.acquireWaitP95Ms,
            acquireWaitMaxMs: counters.acquireWaitMaxMs
          }
        : {})
    };
  } catch {
    return undefined;
  }
}

function clientRetryHint(req: Request): number | undefined {
  const raw = req.headers["x-retry-count"] ?? req.headers["x-client-retry"];
  if (raw == null) return undefined;
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

/**
 * Lightweight observability middleware — safe for production.
 * Preserves [slow-api] warnings; adds opt-in [api-metrics] for cold-start routes.
 */
export function requestMetricsMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  const requestId = getOrCreateRequestId(req);
  res.setHeader("X-Request-Id", requestId);

  const start = process.hrtime.bigint();
  const slowMs = getSlowApiThresholdMs();
  const metricsOn = isApiMetricsEnabled();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const route = normalizeMetricRoute(req.originalUrl || req.url || "/");
    const method = req.method;
    const statusCode = res.statusCode;
    const authenticated = Boolean(req.user?.id);
    const slow = durationMs >= slowMs;
    const failed = statusCode >= 400;
    const retryCount = clientRetryHint(req);

    if (slow) {
      console.warn(
        `[slow-api] ${durationMs.toFixed(0)}ms ${method} ${route} status=${statusCode} requestId=${requestId}${
          authenticated ? " auth=1" : " auth=0"
        }`
      );
    }

    // Phase 3Q — correlate slow/failed requests without sensitive payloads
    if (slow || failed) {
      const pool =
        process.env.DB_POOL_DEBUG === "true" || process.env.API_METRICS === "1"
          ? maybePoolSnapshot()
          : undefined;
      try {
        console.info(
          "[request-correlate]",
          JSON.stringify({
            requestId,
            method,
            route,
            statusCode,
            durationMs: Math.round(durationMs * 100) / 100,
            slow,
            failed,
            authenticated,
            ...(retryCount != null ? { clientRetryCount: retryCount } : {}),
            ...(pool ? { pool } : {}),
            correlate: [
              "Match [home-metrics]|[feed-metrics]|[media-metrics]|[slow-query] by requestId",
              "pool.waiting/acquireWait* are process-wide samples when DB_POOL_DEBUG=true — not proof of root cause alone"
            ]
          })
        );
      } catch {
        /* ignore */
      }
    }

    if (!metricsOn) return;
    if (!shouldEmitApiMetric(route, getAllowlist())) return;

    const payload: Parameters<typeof logApiMetric>[0] = {
      requestId,
      method,
      route,
      statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      authenticated
    };
    if (shouldIncludeUserIdInMetrics() && typeof req.user?.id === "number") {
      payload.userId = req.user.id;
    }
    if (process.env.DB_POOL_DEBUG === "true") {
      const pool = maybePoolSnapshot();
      if (pool) {
        payload.pool = {
          using: pool.using,
          waiting: pool.waiting,
          available: pool.available,
          size: pool.size
        };
      }
    }
    logApiMetric(payload);
  });

  runWithRequestContext({ requestId }, () => next());
}

/** @deprecated Prefer requestMetricsMiddleware — alias for older imports. */
export const slowApiLogger = requestMetricsMiddleware;
