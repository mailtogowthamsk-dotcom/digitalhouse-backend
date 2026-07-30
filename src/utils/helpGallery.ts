import { HELP_MAX_PHOTOS } from "../constants/helpingHands.constants";
import { toPublicUrlIfR2, toStorageKeyIfR2 } from "./r2Client";

/** Normalize raw gallery JSON + optional cover into a unique URL list. */
export function parseHelpGallery(raw: unknown, mediaUrl?: string | null): string[] {
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
  return [...new Set(arr)].slice(0, HELP_MAX_PHOTOS);
}

export function resolveHelpMedia(
  mediaUrl?: string | null,
  gallery?: string[] | null
): { mediaUrl: string | null; helpGallery: string[] | null } {
  const urls = parseHelpGallery(gallery ?? null, mediaUrl);
  if (urls.length === 0) {
    return { mediaUrl: null, helpGallery: null };
  }
  return { mediaUrl: urls[0], helpGallery: urls };
}

export async function publicHelpGallery(urls: string[]): Promise<string[]> {
  return Promise.all(urls.map(async (u) => (await toPublicUrlIfR2(u)) ?? u));
}
