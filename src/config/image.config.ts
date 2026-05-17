/**
 * Central image optimization settings (env overrides supported).
 */

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Max long edge for stored "full" variant (px). */
export const IMAGE_MAX_DIMENSION = envInt("IMAGE_MAX_DIMENSION", 1920);

/** Target bytes for full variant after optimization (~300–500 KB). */
export const IMAGE_TARGET_BYTES = envInt("IMAGE_TARGET_BYTES", 450_000);

/** Medium variant max long edge (px). */
export const IMAGE_MEDIUM_MAX = envInt("IMAGE_MEDIUM_MAX", 1080);

/** Thumbnail max long edge (px). */
export const IMAGE_THUMB_MAX = envInt("IMAGE_THUMB_MAX", 320);

/** Max bytes client may declare for pre-optimized upload URL request. */
export const IMAGE_UPLOAD_MAX_BYTES = envInt("IMAGE_UPLOAD_MAX_BYTES", 2 * 1024 * 1024);

/** Max bytes server will download from R2 for processing (safety cap). */
export const IMAGE_PROCESS_DOWNLOAD_MAX_BYTES = envInt(
  "IMAGE_PROCESS_DOWNLOAD_MAX_BYTES",
  12 * 1024 * 1024
);

/** WebP quality starting point (0–100). */
export const IMAGE_WEBP_QUALITY = envInt("IMAGE_WEBP_QUALITY", 82);

/** Minimum WebP quality when iterating down. */
export const IMAGE_WEBP_QUALITY_MIN = envInt("IMAGE_WEBP_QUALITY_MIN", 55);

export const IMAGE_OUTPUT_MIME = "image/webp";
