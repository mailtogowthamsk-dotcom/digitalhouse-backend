/** Prominent People — Hall of Fame module constants */

export const PROMINENT_SORT_OPTIONS = ["latest", "alphabetical"] as const;
export type ProminentSortOption = (typeof PROMINENT_SORT_OPTIONS)[number];

export const PROMINENT_MEDIA_KINDS = ["profile", "hero", "gallery"] as const;
export type ProminentMediaKind = (typeof PROMINENT_MEDIA_KINDS)[number];

export const PROMINENT_LIST_CACHE_TTL_MS = 60_000;
export const PROMINENT_FEATURED_CACHE_TTL_MS = 60_000;
export const PROMINENT_CATEGORIES_CACHE_TTL_MS = 5 * 60_000;

export const PROMINENT_DEFAULT_PAGE_SIZE = 12;
export const PROMINENT_MAX_PAGE_SIZE = 40;
