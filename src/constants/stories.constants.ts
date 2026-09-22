/** Stories / status — 24h ephemeral media for owner + accepted connections only. */

export const STORY_TTL_MS = 24 * 60 * 60 * 1000;
/** Fixed display time for image / text stories (ms). */
export const STORY_IMAGE_DURATION_MS = 5_000;
/** Text-only stories stay on screen a bit longer. */
export const STORY_TEXT_DURATION_MS = 7_000;
/**
 * Story video duration bounds (seconds).
 * Product + security contract — keep in sync with mobile `stories.constants.ts`.
 * Backend always measures actual media via ffprobe; never trust client duration alone.
 */
export const STORY_VIDEO_MIN_DURATION_SEC = 3;
/** Final story clip after trim (1 minute). */
export const STORY_VIDEO_MAX_DURATION_SEC = 60;
/** Caption overlay on image/video (also used as text-story body max). */
export const STORY_CAPTION_MAX_LENGTH = 200;
/** Placeholder mediaUrl for text stories (no disk file). */
export const STORY_TEXT_MEDIA_KEY = "text://";
/** Max length for a story reply that becomes a chat message. */
export const STORY_REPLY_MAX_LENGTH = 500;
/**
 * Uploaded bytes that never become a Story row are removed after this age.
 * Override with STORY_UPLOAD_ORPHAN_MAX_AGE_HOURS.
 */
export const STORY_UPLOAD_ORPHAN_MAX_AGE_HOURS = Math.max(
  1,
  Number(process.env.STORY_UPLOAD_ORPHAN_MAX_AGE_HOURS || 24) || 24
);
/** Minimum HMAC signing secret length (production). */
export const STORIES_MEDIA_SIGNING_SECRET_MIN_LEN = 32;

export function storyExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + STORY_TTL_MS);
}

export function normalizeStoryCaption(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.slice(0, STORY_CAPTION_MAX_LENGTH);
}
