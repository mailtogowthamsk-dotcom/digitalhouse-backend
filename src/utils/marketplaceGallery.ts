import { MARKETPLACE_MAX_PHOTOS } from "../constants/marketplace.constants";
import { toSignedUrlIfR2 } from "../utils/r2Client";

/** Normalize raw gallery JSON + optional cover into a unique URL list (max MARKETPLACE_MAX_PHOTOS). */
export function parseMarketplaceGallery(
  raw: unknown,
  mediaUrl?: string | null
): string[] {
  let arr: string[] = [];
  if (Array.isArray(raw)) {
    arr = raw
      .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
      .map((u) => u.trim());
  } else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        arr = parsed
          .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
          .map((u) => u.trim());
      }
    } catch {
      /* ignore */
    }
  }
  const cover = mediaUrl?.trim() || null;
  if (cover) {
    arr = [cover, ...arr.filter((u) => u !== cover)];
  }
  return [...new Set(arr)].slice(0, MARKETPLACE_MAX_PHOTOS);
}

/** Resolve cover + gallery for create/update payloads. */
export function resolveMarketplaceMedia(
  mediaUrl?: string | null,
  gallery?: string[] | null
): { mediaUrl: string | null; marketplaceGallery: string[] | null } {
  const urls = parseMarketplaceGallery(gallery ?? null, mediaUrl);
  if (urls.length === 0) {
    return { mediaUrl: null, marketplaceGallery: null };
  }
  return { mediaUrl: urls[0], marketplaceGallery: urls };
}

export async function signMarketplaceGallery(urls: string[]): Promise<string[]> {
  return Promise.all(urls.map(async (u) => (await toSignedUrlIfR2(u)) ?? u));
}
