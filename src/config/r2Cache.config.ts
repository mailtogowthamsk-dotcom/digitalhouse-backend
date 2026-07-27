/**
 * Long-lived CDN/browser cache for immutable content-addressed R2 keys.
 * ETag / Last-Modified are served by R2/S3 on GET when Range/conditional requests are used.
 */
export const R2_CACHE_CONTROL_IMMUTABLE = "public, max-age=31536000, immutable";

/** Shorter cache for staging/temp uploads that may be replaced (still helps CDN briefly). */
export const R2_CACHE_CONTROL_STAGING = "public, max-age=3600";
