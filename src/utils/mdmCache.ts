import { MDM_CACHE_TTL_MS } from "../constants/masterData.constants";

type CacheEntry<T> = { expiresAt: number; value: T };

const store = new Map<string, CacheEntry<unknown>>();
const listeners = new Set<() => void>();

export function mdmCacheGet<T>(key: string): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    store.delete(key);
    return null;
  }
  return hit.value as T;
}

export function mdmCacheSet<T>(key: string, value: T, ttlMs = MDM_CACHE_TTL_MS): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Invalidate all MDM caches (call after any admin write). */
export function mdmCacheInvalidateAll(): void {
  store.clear();
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

export function onMdmCacheInvalidate(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function mdmCacheKey(parts: Array<string | number | null | undefined>): string {
  return parts.map((p) => (p == null ? "_" : String(p))).join("|");
}
