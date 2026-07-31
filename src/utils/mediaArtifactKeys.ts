/**
 * Derive R2 keys for media variants / staging leftovers.
 * Kept free of Sequelize so r2Client and MediaProcessing can share safely.
 */

import { variantKeysFromUploadKey } from "./imageProcessor";
import path from "path";

/** Image variants from a staging upload key (e.g. …/foo.webp → …/foo_full.webp). */
export function imageVariantKeys(stagingKey: string) {
  return variantKeysFromUploadKey(stagingKey);
}

/**
 * Likely staging object keys given a completed `_full.webp` key.
 * Mobile uploads are typically `.webp`; also try common raster extensions.
 */
export function imageStagingCandidatesFromFullKey(fullKey: string): string[] {
  if (!fullKey.endsWith("_full.webp")) return [];
  const base = fullKey.slice(0, -"_full.webp".length);
  return [`${base}.webp`, `${base}.jpg`, `${base}.jpeg`, `${base}.png`];
}

export function videoOptimizedKey(stagingKey: string): string {
  const dir = path.posix.dirname(stagingKey);
  const base = path.posix.basename(stagingKey).replace(/\.[^.]+$/, "");
  return `${dir}/${base}_opt.mp4`;
}

/** Staging original given an optimized `*_opt.mp4` key. */
export function videoStagingKeyFromOptimized(optKey: string): string | null {
  if (!optKey.endsWith("_opt.mp4")) return null;
  return `${optKey.slice(0, -"_opt.mp4".length)}.mp4`;
}

export function videoPosterKeys(stagingKey: string): {
  thumbKey: string;
  mediumKey: string;
  fullKey: string;
} {
  const base = path.posix.basename(stagingKey).replace(/\.[^.]+$/, "");
  const m = stagingKey.match(/^(.*\/videos\/)posts\/(\d{4}\/\d{2}\/)(.+)$/);
  const root = m ? `${m[1]}thumbnails/${m[2]}` : `${path.posix.dirname(stagingKey)}/`;
  return {
    thumbKey: `${root}${base}_poster_thumb.webp`,
    mediumKey: `${root}${base}_poster_md.webp`,
    fullKey: `${root}${base}_poster_full.webp`
  };
}

/** Poster keys when we only know the optimized or staging video key. */
export function videoPosterKeysFromVideoKey(videoKey: string): {
  thumbKey: string;
  mediumKey: string;
  fullKey: string;
} {
  const staging =
    videoStagingKeyFromOptimized(videoKey) ??
    (videoKey.endsWith(".mp4") ? videoKey : null);
  if (!staging) {
    const dir = path.posix.dirname(videoKey);
    const base = path.posix.basename(videoKey).replace(/\.[^.]+$/, "").replace(/_opt$/, "");
    return {
      thumbKey: `${dir}/${base}_poster_thumb.webp`,
      mediumKey: `${dir}/${base}_poster_md.webp`,
      fullKey: `${dir}/${base}_poster_full.webp`
    };
  }
  return videoPosterKeys(staging);
}

/**
 * Collect every artifact key that should be removed when deleting a media object.
 * Always includes the input key; expands known image/video sibling patterns.
 */
export function collectMediaArtifactKeys(
  urlOrKey: string,
  variantsJson?: string | null
): string[] {
  const keys = new Set<string>();
  const add = (k: string | null | undefined) => {
    if (k && k.startsWith("digital-house/")) keys.add(k);
  };

  add(urlOrKey);

  if (variantsJson) {
    try {
      const parsed = JSON.parse(variantsJson) as Record<string, unknown>;
      for (const v of Object.values(parsed)) {
        if (typeof v === "string") add(v);
      }
    } catch {
      /* ignore */
    }
  }

  if (urlOrKey.endsWith("_full.webp")) {
    const { thumbKey, mediumKey, fullKey } = {
      thumbKey: urlOrKey.replace(/_full\.webp$/, "_thumb.webp"),
      mediumKey: urlOrKey.replace(/_full\.webp$/, "_md.webp"),
      fullKey: urlOrKey
    };
    add(thumbKey);
    add(mediumKey);
    add(fullKey);
    for (const s of imageStagingCandidatesFromFullKey(fullKey)) add(s);
  } else if (urlOrKey.endsWith("_md.webp") || urlOrKey.endsWith("_thumb.webp")) {
    const fullKey = urlOrKey.endsWith("_md.webp")
      ? urlOrKey.replace(/_md\.webp$/, "_full.webp")
      : urlOrKey.replace(/_thumb\.webp$/, "_full.webp");
    add(fullKey);
    add(fullKey.replace(/_full\.webp$/, "_md.webp"));
    add(fullKey.replace(/_full\.webp$/, "_thumb.webp"));
    for (const s of imageStagingCandidatesFromFullKey(fullKey)) add(s);
  } else if (/\.(webp|jpe?g|png)$/i.test(urlOrKey) && !/_(full|md|thumb)\.webp$/i.test(urlOrKey)) {
    // Staging-looking image key → also wipe variants
    const { thumbKey, mediumKey, fullKey } = imageVariantKeys(urlOrKey);
    add(thumbKey);
    add(mediumKey);
    add(fullKey);
  }

  if (urlOrKey.endsWith("_opt.mp4") || urlOrKey.endsWith(".mp4")) {
    const staging = videoStagingKeyFromOptimized(urlOrKey);
    if (staging) {
      add(staging);
      add(urlOrKey);
      const posters = videoPosterKeys(staging);
      add(posters.thumbKey);
      add(posters.mediumKey);
      add(posters.fullKey);
    } else if (urlOrKey.endsWith(".mp4")) {
      add(videoOptimizedKey(urlOrKey));
      const posters = videoPosterKeys(urlOrKey);
      add(posters.thumbKey);
      add(posters.mediumKey);
      add(posters.fullKey);
    }
  }

  if (/_poster_(thumb|md|full)\.webp$/i.test(urlOrKey)) {
    const base = urlOrKey.replace(/_poster_(thumb|md|full)\.webp$/i, "");
    add(`${base}_poster_thumb.webp`);
    add(`${base}_poster_md.webp`);
    add(`${base}_poster_full.webp`);
  }

  return [...keys];
}
