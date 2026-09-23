/**
 * Backward-compatible export.
 * Slow-API logging now lives inside requestMetricsMiddleware
 * (still emits [slow-api] when duration >= SLOW_API_MS).
 */
export { requestMetricsMiddleware as slowApiLogger } from "./requestMetrics.middleware";
export { requestMetricsMiddleware } from "./requestMetrics.middleware";
