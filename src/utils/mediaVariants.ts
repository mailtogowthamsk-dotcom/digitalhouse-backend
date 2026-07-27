/**
 * Derive WebP variant URLs from a stored full image CDN URL.
 * Backward compatible: if not a _full.webp key, all variants point at the same URL.
 */

export type MediaVariantUrls = {
  thumb: string;
  medium: string;
  full: string;
};

export function deriveImageVariantUrls(mediaUrl: string | null | undefined): MediaVariantUrls | null {
  if (!mediaUrl?.trim()) return null;
  const u = mediaUrl.trim();
  if (/_full\.webp(\?|$)/i.test(u)) {
    return {
      full: u,
      medium: u.replace(/_full\.webp/i, "_md.webp"),
      thumb: u.replace(/_full\.webp/i, "_thumb.webp")
    };
  }
  if (/_md\.webp(\?|$)/i.test(u)) {
    return {
      medium: u,
      full: u.replace(/_md\.webp/i, "_full.webp"),
      thumb: u.replace(/_md\.webp/i, "_thumb.webp")
    };
  }
  return { thumb: u, medium: u, full: u };
}
