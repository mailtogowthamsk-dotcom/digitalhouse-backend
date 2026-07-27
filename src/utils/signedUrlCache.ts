/**
 * Short-TTL in-process cache for R2 signed GET URLs.
 * Reuses signatures until near expiry — avoids crypto on every feed hydration.
 */
type CacheEntry = { url: string; expiresAt: number };

const cache = new Map<string, CacheEntry>();
/** Default below typical 1h signed expiry; overridden per-call from r2Client. */
const DEFAULT_TTL_MS = 55 * 60 * 1000;
const MAX_ENTRIES = 4000;

function pruneIfNeeded() {
  if (cache.size <= MAX_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expiresAt <= now) cache.delete(k);
  }
  if (cache.size <= MAX_ENTRIES) return;
  const drop = cache.size - MAX_ENTRIES;
  let i = 0;
  for (const k of cache.keys()) {
    cache.delete(k);
    if (++i >= drop) break;
  }
}

export function getCachedSignedUrl(cacheKey: string): string | null {
  const hit = cache.get(cacheKey);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(cacheKey);
    return null;
  }
  return hit.url;
}

export function setCachedSignedUrl(
  cacheKey: string,
  url: string,
  ttlMs = DEFAULT_TTL_MS
): void {
  pruneIfNeeded();
  cache.set(cacheKey, { url, expiresAt: Date.now() + ttlMs });
}

export function clearSignedUrlCache(): void {
  cache.clear();
}
