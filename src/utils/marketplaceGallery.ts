import { MARKETPLACE_MAX_PHOTOS } from "../constants/marketplace.constants";
import { isPrivateR2Object, toPrivateSignedUrlIfR2, toPublicUrlIfR2, toStorageKeyIfR2 } from "../utils/r2Client";

/** Normalize raw gallery JSON + optional cover into a unique URL list. */
export function parseMarketplaceGallery(
  raw: unknown,
  mediaUrl?: string | null,
  maxPhotos: number = MARKETPLACE_MAX_PHOTOS
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
  // Compare and store as object keys so a legacy CDN URL and its key form
  // cannot both survive de-duplication.
  arr = arr.map((u) => toStorageKeyIfR2(u) ?? u);
  const cover = toStorageKeyIfR2(mediaUrl ?? null);
  if (cover) {
    arr = [cover, ...arr.filter((u) => u !== cover)];
  }
  const limit = Number.isFinite(maxPhotos) && maxPhotos > 0 ? Math.floor(maxPhotos) : MARKETPLACE_MAX_PHOTOS;
  return [...new Set(arr)].slice(0, limit);
}

/** Resolve cover + gallery for create/update payloads. */
export function resolveMarketplaceMedia(
  mediaUrl?: string | null,
  gallery?: string[] | null,
  maxPhotos: number = MARKETPLACE_MAX_PHOTOS
): { mediaUrl: string | null; marketplaceGallery: string[] | null } {
  const urls = parseMarketplaceGallery(gallery ?? null, mediaUrl, maxPhotos);
  if (urls.length === 0) {
    return { mediaUrl: null, marketplaceGallery: null };
  }
  return { mediaUrl: urls[0], marketplaceGallery: urls };
}

export async function publicMarketplaceGallery(
  urls: string[],
  options?: { signPrivate?: boolean }
): Promise<string[]> {
  const out: string[] = [];
  for (const u of urls) {
    if (isPrivateR2Object(u)) {
      if (!options?.signPrivate) continue;
      const signed = await toPrivateSignedUrlIfR2(u);
      if (signed) out.push(signed);
      continue;
    }
    const pub = toPublicUrlIfR2(u);
    if (pub) out.push(pub);
  }
  return out;
}
