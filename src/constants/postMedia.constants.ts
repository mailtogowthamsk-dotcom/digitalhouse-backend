/** Post media types — foundation for Reels / Stories later. */
export const POST_MEDIA_TYPES = ["image", "video", "none"] as const;
export type PostMediaType = (typeof POST_MEDIA_TYPES)[number];

export const ALLOWED_POST_IMAGE_MIMES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp"
] as const;

/** MP4 only for new uploads (H.264/AAC validated/optimized server-side). Legacy MOV still plays. */
export const ALLOWED_POST_VIDEO_MIMES = ["video/mp4"] as const;

/** Extensions rejected for new video uploads (MIME alone is not enough). */
export const REJECTED_VIDEO_EXTENSIONS = [
  ".avi",
  ".mov",
  ".mkv",
  ".webm",
  ".3gp",
  ".3g2",
  ".flv",
  ".wmv",
  ".mpeg",
  ".mpg"
] as const;

/** Allowed extension for new video uploads. */
export const ALLOWED_NEW_VIDEO_EXTENSIONS = [".mp4"] as const;

/** Legacy MIME types still recognized for playback of existing posts (not accepted for new uploads). */
export const LEGACY_POST_VIDEO_MIMES = [
  "video/quicktime",
  "video/x-m4v",
  "video/m4v"
] as const;

/** Declared upload size for images after client compression (presign). */
export const POST_IMAGE_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

/** Max video size after client compression (must match mobile VIDEO_MAX_BYTES). */
export const POST_VIDEO_MAX_BYTES = 50 * 1024 * 1024;

/** Max video duration in seconds (1 minute short-form). */
export const POST_VIDEO_MAX_DURATION_SEC = 60;

/** Minimum video duration in seconds. */
export const POST_VIDEO_MIN_DURATION_SEC = 3;

const VIDEO_EXT = /\.(mp4|mov|m4v)(\?|$)/i;

/** True when fileName is safe for a new video upload (MP4 only). */
export function isAllowedNewVideoFileName(fileName: string): boolean {
  const base = fileName.trim().split(/[\\/]/).pop() || "";
  const lower = base.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = lower.slice(dot);
  if ((REJECTED_VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return false;
  return (ALLOWED_NEW_VIDEO_EXTENSIONS as readonly string[]).includes(ext);
}

export function isVideoMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  const m = mime.toLowerCase();
  return (
    (ALLOWED_POST_VIDEO_MIMES as readonly string[]).includes(m) ||
    (LEGACY_POST_VIDEO_MIMES as readonly string[]).includes(m)
  );
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
