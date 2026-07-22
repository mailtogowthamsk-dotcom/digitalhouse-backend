/** Post media types — foundation for Reels / Stories later. */
export const POST_MEDIA_TYPES = ["image", "video", "none"] as const;
export type PostMediaType = (typeof POST_MEDIA_TYPES)[number];

export const ALLOWED_POST_IMAGE_MIMES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp"
] as const;

/** MP4, MOV (QuickTime), M4V */
export const ALLOWED_POST_VIDEO_MIMES = [
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/m4v"
] as const;

/** Declared upload size for images after client compression (presign). */
export const POST_IMAGE_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

/** Max video size after client compression (must match mobile VIDEO_MAX_BYTES). */
export const POST_VIDEO_MAX_BYTES = 50 * 1024 * 1024;

/** Max video duration in seconds (2 minutes). */
export const POST_VIDEO_MAX_DURATION_SEC = 120;

const VIDEO_EXT = /\.(mp4|mov|m4v)(\?|$)/i;

export function isVideoMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  const m = mime.toLowerCase();
  return (ALLOWED_POST_VIDEO_MIMES as readonly string[]).includes(m);
}

export function looksLikeVideoUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  return VIDEO_EXT.test(url.trim());
}

/**
 * Resolve mediaType for create/update with backward compatibility.
 * Prefer explicit client value; otherwise infer from mime / URL.
 */
export function resolvePostMediaType(input: {
  mediaUrl: string | null | undefined;
  mediaType?: PostMediaType | null;
  mimeType?: string | null;
}): PostMediaType {
  const url = input.mediaUrl?.trim() || null;
  if (!url) return "none";
  if (input.mediaType === "image" || input.mediaType === "video" || input.mediaType === "none") {
    if (input.mediaType === "none") return "none";
    return input.mediaType;
  }
  if (isVideoMime(input.mimeType) || looksLikeVideoUrl(url)) return "video";
  return "image";
}
