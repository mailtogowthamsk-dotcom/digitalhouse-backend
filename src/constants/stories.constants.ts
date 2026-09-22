/** Stories / status — 24h ephemeral media for owner + accepted connections only. */

export const STORY_TTL_MS = 24 * 60 * 60 * 1000;
/** Fixed display time for image stories (ms). */
export const STORY_IMAGE_DURATION_MS = 5_000;
/** Max video length for stories (seconds). Enforced client + server. */
export const STORY_VIDEO_MAX_DURATION_SEC = 30;
export const STORY_VIDEO_MIN_DURATION_SEC = 1;
/** Optional caption shown as letters at the bottom of the viewer. */
export const STORY_CAPTION_MAX_LENGTH = 120;
/** Max length for a story reply that becomes a chat message. */
export const STORY_REPLY_MAX_LENGTH = 500;

export function storyExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + STORY_TTL_MS);
}

export function normalizeStoryCaption(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.slice(0, STORY_CAPTION_MAX_LENGTH);
}
