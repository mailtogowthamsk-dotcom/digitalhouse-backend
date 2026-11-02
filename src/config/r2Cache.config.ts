/**
 * Cache-Control for immutable content-addressed R2 keys (variants / optimized video).
 * ETag / Last-Modified are served by R2 on GET when Range/conditional requests are used.
 */
export const R2_CACHE_CONTROL_IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * @deprecated Use STORY_R2_OBJECT_CACHE_CONTROL from storiesCache.config.
 * Kept as an alias so older imports keep compiling.
 */
export { STORY_R2_OBJECT_CACHE_CONTROL as R2_CACHE_CONTROL_PRIVATE_SHORT } from "./storiesCache.config";
