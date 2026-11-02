/**
 * Story media caching — private objects must never be stored on the shared
 * Cloudflare CDN. Repeat views on one device use the mobile disk cache
 * (256 MB / 26 h, keyed by viewer id + story id) after a live auth check.
 *
 * Why the public CDN is unsafe for Story bytes:
 * - Cache key = object path would let user B receive a HIT of bytes that
 *   user A was authorized to fetch.
 * - Cache key = full presigned URL always misses (unique signature) and
 *   still leaks if the URL is copied during its TTL.
 * - Playback bytes go to the R2 S3 API host (`*.r2.cloudflarestorage.com`),
 *   not `media.konguvettuvagounder.com`. Public CDN is deny-by-prefix only.
 * - Live probe of the media host: unsigned GET of a Story key returns HTTP 404
 *   (not 200). Cloudflare may HIT/MISS-cache that 404 HTML (`max-age=14400`);
 *   that is a cached deny page, not Story bytes. HEAD of the same path is
 *   `CF-Cache-Status: DYNAMIC`.
 *
 * R2 origin still supports HTTP Range on the presigned GET (Range is a
 * request header; it is not signed into the URL). The HMAC gateway 302 must
 * not be cached (Location is viewer-specific). DeleteObject / expiry purge
 * 404s leftover signed URLs; the mobile disk cache revalidates via getStory
 * and drops entries on 401/403/404 or expires_at.
 */
export const STORY_GATEWAY_CACHE_CONTROL = "private, no-store, no-transform";
/** Cloudflare-specific: do not store at the edge even if Cache-Control is loosened. */
export const STORY_CDN_CACHE_CONTROL = "no-store";
/** PutObject + signed GET ResponseCacheControl override. */
export const STORY_R2_OBJECT_CACHE_CONTROL = "private, no-store";

export function storyGatewayCacheHeaders(): Record<string, string> {
  return {
    "Cache-Control": STORY_GATEWAY_CACHE_CONTROL,
    "CDN-Cache-Control": STORY_CDN_CACHE_CONTROL,
    "Surrogate-Control": STORY_CDN_CACHE_CONTROL
  };
}
