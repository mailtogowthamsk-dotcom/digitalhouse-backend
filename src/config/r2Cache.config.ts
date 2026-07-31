/**
 * Cache-Control for immutable content-addressed R2 keys (variants / optimized video).
 * ETag / Last-Modified are served by R2 on GET when Range/conditional requests are used.
 */
export const R2_CACHE_CONTROL_IMMUTABLE = "public, max-age=31536000, immutable";
