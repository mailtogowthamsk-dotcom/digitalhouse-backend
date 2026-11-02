/**
 * Cloudflare R2 storage for ephemeral Stories media.
 * Keys live under digital-house/private/stories/{userId}/{yyyy}/{mm}/...
 * so the public CDN never serves them. Playback uses the HMAC gateway +
 * short-lived presigned GET (see Stories.service openStoryMediaFile).
 *
 * Does not replace StoryLocalStorage — leftover local/stories/ keys stay on disk.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  STORY_R2_KEY_PREFIX,
  STORY_UPLOAD_ORPHAN_MAX_AGE_HOURS,
  STORY_UPLOAD_TMP_PREFIX
} from "../constants/stories.constants";
import { getStoriesR2PlaybackTtlSec } from "../config/storiesRuntime";
import { STORY_R2_OBJECT_CACHE_CONTROL } from "../config/storiesCache.config";
import {
  copyR2Object,
  deleteR2ObjectByKeyOrThrow,
  getPresignedGetUrl,
  getR2ObjectMetadata,
  listR2ObjectsByPrefix,
  putR2ObjectBuffer,
  putR2ObjectFromFile
} from "../utils/r2Client";
import {
  createMediaTempDirectory,
  removeMediaTempDirectory
} from "../utils/mediaTempFiles";
import {
  assertStoryVideoDuration,
  resolveStoryUploadMime,
  type SaveStoryFileResult
} from "./StoryLocalStorage.service";

const DURATION_META_KEY = "duration-seconds";

function clientError(message: string, status = 400, code?: string): never {
  throw Object.assign(new Error(message), { status, code });
}

function extensionForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m === "image/webp") return ".webp";
  if (m === "image/jpeg" || m === "image/jpg") return ".jpg";
  if (m === "image/png") return ".png";
  if (m === "video/mp4") return ".mp4";
  return ".bin";
}

function uniqueBaseName(): string {
  return `${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

export function isStoryR2Key(key: string | null | undefined): boolean {
  if (!key || typeof key !== "string") return false;
  if (key.includes("..") || key.includes("\\") || key.startsWith("/")) return false;
  return key.startsWith(STORY_R2_KEY_PREFIX);
}

export function isPendingStoryR2UploadKey(key: string): boolean {
  if (!isStoryR2Key(key)) return false;
  return path.posix.basename(key).startsWith(STORY_UPLOAD_TMP_PREFIX);
}

export function assertOwnedStoryR2Key(userId: number, key: string): void {
  const expected = `${STORY_R2_KEY_PREFIX}${userId}/`;
  if (!isStoryR2Key(key) || !key.startsWith(expected)) {
    throw Object.assign(new Error("Invalid story media reference"), {
      status: 400,
      code: "INVALID_STORY_MEDIA"
    });
  }
}

function buildPendingStoryR2Key(userId: number, mime: string): string {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const fileName = `${STORY_UPLOAD_TMP_PREFIX}${uniqueBaseName()}${extensionForMime(mime)}`;
  return `${STORY_R2_KEY_PREFIX}${userId}/${yyyy}/${mm}/${fileName}`;
}

function storiesR2Log(
  event: string,
  fields: Record<string, string | number | boolean | null | undefined>
): void {
  console.info("[stories-r2]", { event, ...fields });
}

export async function saveStoryR2File(
  userId: number,
  buffer: Buffer,
  mimeType: string
): Promise<SaveStoryFileResult> {
  const { mime, kind } = resolveStoryUploadMime(buffer, mimeType);
  const key = buildPendingStoryR2Key(userId, mime);
  const putOpts = {
    cacheControl: STORY_R2_OBJECT_CACHE_CONTROL
  };

  let durationSeconds: number | null = null;
  if (kind === "video") {
    const tmpDir = await createMediaTempDirectory("dh-probe-");
    const tmpPath = path.join(tmpDir, `story${extensionForMime(mime)}`);
    try {
      await fs.promises.writeFile(tmpPath, buffer, { flag: "wx" });
      durationSeconds = await assertStoryVideoDuration(tmpPath);
      await putR2ObjectFromFile(key, tmpPath, mime, {
        ...putOpts,
        metadata: { [DURATION_META_KEY]: String(durationSeconds) }
      });
    } catch (e) {
      storiesR2Log("upload_failed", {
        userId,
        kind,
        byteSize: buffer.length,
        code: (e as { code?: string })?.code ?? "UPLOAD_FAILED"
      });
      await deleteR2ObjectByKeyOrThrow(key).catch(() => undefined);
      throw e;
    } finally {
      await removeMediaTempDirectory(tmpDir);
    }
  } else {
    try {
      await putR2ObjectBuffer(key, buffer, mime, putOpts);
    } catch (e) {
      storiesR2Log("upload_failed", {
        userId,
        kind,
        byteSize: buffer.length,
        code: (e as { code?: string })?.code ?? "UPLOAD_FAILED"
      });
      throw e;
    }
  }

  storiesR2Log("upload", {
    userId,
    kind,
    byteSize: buffer.length,
    pending: true
  });

  return {
    key,
    absolutePath: key,
    byteSize: buffer.length,
    mimeType: mime,
    kind,
    durationSeconds
  };
}

/**
 * Copy tmp_* → permanent key. Does NOT delete the tmp object.
 * Caller must update the Story row first, then delete tmp, so a failed
 * DB write cannot leave the row pointing at a deleted object.
 */
export async function promoteStoryR2UploadKey(relativeKey: string): Promise<string> {
  if (!isStoryR2Key(relativeKey)) {
    clientError("Invalid story media reference", 400, "INVALID_STORY_MEDIA");
  }
  if (!isPendingStoryR2UploadKey(relativeKey)) {
    return relativeKey;
  }
  const dir = path.posix.dirname(relativeKey);
  const base = path.posix.basename(relativeKey);
  const promotedBase = base.slice(STORY_UPLOAD_TMP_PREFIX.length);
  if (!promotedBase) {
    clientError("Invalid story media reference", 400, "INVALID_STORY_MEDIA");
  }
  const promotedKey = `${dir}/${promotedBase}`;
  await copyR2Object(relativeKey, promotedKey);
  return promotedKey;
}

export async function deleteStoryR2Object(relativeKey: string | null | undefined): Promise<boolean> {
  if (!relativeKey || !isStoryR2Key(relativeKey)) return false;
  try {
    await deleteR2ObjectByKeyOrThrow(relativeKey);
    storiesR2Log("delete", { ok: true });
    return true;
  } catch (e) {
    storiesR2Log("delete_failed", {
      ok: false,
      message: e instanceof Error ? e.message.slice(0, 120) : "unknown"
    });
    return false;
  }
}

export async function assertStoryR2ObjectReady(
  userId: number,
  key: string
): Promise<{ byteSize: number; contentType: string | null; durationSeconds: number | null }> {
  assertOwnedStoryR2Key(userId, key);
  const meta = await getR2ObjectMetadata(key);
  if (meta.byteSize <= 0) {
    clientError("Uploaded media object is empty", 400, "EMPTY_OBJECT");
  }
  const rawDuration = meta.metadata?.[DURATION_META_KEY] ?? meta.metadata?.["durationseconds"];
  const durationSeconds =
    rawDuration != null && Number.isFinite(Number(rawDuration)) ? Number(rawDuration) : null;
  return {
    byteSize: meta.byteSize,
    contentType: meta.contentType,
    durationSeconds
  };
}

export async function signStoryR2PlaybackUrl(key: string): Promise<string> {
  if (!isStoryR2Key(key)) {
    clientError("Story media not found", 404, "STORY_MEDIA_MISSING");
  }
  const ttl = getStoriesR2PlaybackTtlSec();
  const url = await getPresignedGetUrl(key, ttl, {
    responseCacheControl: STORY_R2_OBJECT_CACHE_CONTROL
  });
  storiesR2Log("playback_url_issued", { ttlSec: ttl });
  return url;
}

export type R2OrphanCleanupResult = {
  scanned: number;
  deleted: number;
  failures: number;
};

/**
 * Delete abandoned tmp_* R2 uploads older than maxAgeHours.
 * Never deletes keys still referenced by a Story row.
 */
export async function cleanupOrphanStoryR2Uploads(opts: {
  referencedKeys: Set<string>;
  maxAgeHours?: number;
}): Promise<R2OrphanCleanupResult> {
  const maxAgeHours = opts.maxAgeHours ?? STORY_UPLOAD_ORPHAN_MAX_AGE_HOURS;
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  const result: R2OrphanCleanupResult = { scanned: 0, deleted: 0, failures: 0 };

  let listed: Awaited<ReturnType<typeof listR2ObjectsByPrefix>>;
  try {
    listed = await listR2ObjectsByPrefix(STORY_R2_KEY_PREFIX, 5000);
  } catch (e) {
    storiesR2Log("orphan_list_failed", {
      message: e instanceof Error ? e.message.slice(0, 120) : "unknown"
    });
    return { scanned: 0, deleted: 0, failures: 1 };
  }

  for (const obj of listed) {
    if (!isPendingStoryR2UploadKey(obj.key)) continue;
    result.scanned += 1;
    if (opts.referencedKeys.has(obj.key)) continue;
    if (!obj.lastModified) continue;
    const modified = obj.lastModified.getTime();
    if (modified > cutoff) continue;
    try {
      await deleteR2ObjectByKeyOrThrow(obj.key);
      result.deleted += 1;
    } catch {
      result.failures += 1;
    }
  }

  storiesR2Log("orphan_cleanup", {
    scanned: result.scanned,
    deleted: result.deleted,
    failures: result.failures,
    maxAgeHours
  });
  return result;
}
