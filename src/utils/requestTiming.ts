/**
 * Production-safe request timing helpers.
 * No passwords, OTPs, tokens, cookies, or bodies — route + timing only.
 */

import { randomUUID } from "crypto";
import type { Request } from "express";

export type ApiMetricPayload = {
  requestId: string;
  method: string;
  /** Path without query string */
  route: string;
  statusCode: number;
  durationMs: number;
  authenticated: boolean;
  /** Only when API_METRICS_USER_ID=1 */
  userId?: number;
  /** Optional pool snapshot fields when DB_POOL_DEBUG=true */
  pool?: {
    using: number;
    waiting: number;
    available: number;
    size: number;
  };
};

const REQUEST_ID_HEADER = "x-request-id";
const MAX_ROUTE_LEN = 200;

/** Critical cold-start / Home paths (Phase 3B). Matched against path without mount prefix noise. */
export const DEFAULT_API_METRICS_ROUTES = [
  "/auth/me",
  "/platform/bootstrap",
  "/home/bootstrap",
  "/home/summary",
  "/home/feed",
  "/home/quick-actions",
  "/home/highlights",
  "/stories",
  "/notifications/counts",
  "/messages/unread-count"
] as const;

function sanitizeIncomingRequestId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v || v.length > 64) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(v)) return null;
  return v;
}

export function createRequestId(): string {
  try {
    return randomUUID();
  } catch {
    return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function getOrCreateRequestId(req: Request): string {
  const existing = (req as Request & { requestId?: string }).requestId;
  if (existing) return existing;
  const fromHeader =
    sanitizeIncomingRequestId(req.headers[REQUEST_ID_HEADER]) ||
    sanitizeIncomingRequestId(req.headers["x-correlation-id"]);
  const id = fromHeader || createRequestId();
  (req as Request & { requestId?: string }).requestId = id;
  return id;
}

/**
 * Normalize to a stable route key: strip query, strip trailing slash (except root),
 * drop API mount prefix (/api, /api/v1) when present.
 */
export function normalizeMetricRoute(originalUrl: string): string {
  const noQuery = (originalUrl || "/").split("?")[0] || "/";
  let path = noQuery.replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  // Common mounts: /api/... or /api/v1/...
  path = path.replace(/^\/api(?:\/v\d+)?/i, "") || "/";
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > MAX_ROUTE_LEN) path = `${path.slice(0, MAX_ROUTE_LEN)}…`;
  return path;
}

export function parseApiMetricsRouteAllowlist(envValue?: string): Set<string> | null {
  const raw = (envValue ?? process.env.API_METRICS_ROUTES ?? "").trim();
  if (!raw) return null; // null = use DEFAULT when metrics enabled
  if (raw === "*" || raw.toLowerCase() === "all") return new Set(["*"]);
  const set = new Set<string>();
  for (const part of raw.split(",")) {
    const p = part.trim();
    if (!p) continue;
    set.add(normalizeMetricRoute(p.startsWith("/") ? p : `/${p}`));
  }
  return set.size ? set : null;
}

export function shouldEmitApiMetric(
  route: string,
  allowlist: Set<string> | null
): boolean {
  if (allowlist?.has("*")) return true;
  const list = allowlist ?? new Set(DEFAULT_API_METRICS_ROUTES.map((r) => normalizeMetricRoute(r)));
  if (list.has(route)) return true;
  // Prefix match for nested resources (e.g. /stories/:id) when exact /stories listed
  for (const entry of list) {
    if (entry !== "*" && route.startsWith(`${entry}/`)) return true;
  }
  return false;
}

export function isApiMetricsEnabled(): boolean {
  const v = (process.env.API_METRICS || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function shouldIncludeUserIdInMetrics(): boolean {
  const v = (process.env.API_METRICS_USER_ID || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function logApiMetric(payload: ApiMetricPayload): void {
  try {
    console.info("[api-metrics]", JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function getSlowApiThresholdMs(): number {
  const n = Number(process.env.SLOW_API_MS || 800);
  return Number.isFinite(n) && n > 0 ? n : 800;
}
