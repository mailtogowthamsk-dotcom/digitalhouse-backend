/**
 * Local-disk storage for ephemeral Stories media (NOT R2).
 * Files live under STORIES_STORAGE_DIR and are hard-deleted on expiry/owner delete.
 *
 * Upload flow: save as tmp_* → POST /stories promotes → orphan job deletes abandoned tmp_*.
 *
 * Note: avoid importing media.validation / models here (circular env → productionSecurity).
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  getStoriesStorageDir,
  resolveStoriesMediaSigningSecret
} from "../config/storiesRuntime";
import { detectMediaMimeFromBytes, isExecutableOrScriptMagic } from "../utils/mediaMagic.util";
import {
  STORY_UPLOAD_ORPHAN_MAX_AGE_HOURS,
  STORY_VIDEO_MAX_DURATION_SEC,
  STORY_VIDEO_MIN_DURATION_SEC
} from "../constants/stories.constants";

export const LOCAL_STORY_KEY_PREFIX = "local/stories/";
/** Upload files use this basename prefix until POST /stories promotes them. */
export const STORY_UPLOAD_TMP_PREFIX = "tmp_";

const ALLOWED_IMAGE = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const ALLOWED_VIDEO = new Set(["video/mp4"]);
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;

/** Signed media URL lifetime for Image/Video players (no Authorization header). */
const MEDIA_URL_TTL_SEC = Number(process.env.STORIES_MEDIA_URL_TTL_SEC || 6 * 60 * 60);

function storageRoot(): string {
  return getStoriesStorageDir();
}

function mediaSigningSecret(): string {
  return resolveStoriesMediaSigningSecret();
}

export function isLocalStoryKey(key: string | null | undefined): boolean {
  if (!key || typeof key !== "string") return false;
  return key.startsWith(LOCAL_STORY_KEY_PREFIX);
}

/** Resolve absolute path; rejects path traversal outside the stories root. */
export function absolutePathForStoryKey(relativeKey: string): string {
  if (!isLocalStoryKey(relativeKey)) {
    throw Object.assign(new Error("Not a local story media key"), { status: 400 });
  }
  const rel = relativeKey.slice(LOCAL_STORY_KEY_PREFIX.length).replace(/^\/+/, "");
  if (!rel || rel.includes("..") || path.isAbsolute(rel)) {
    throw Object.assign(new Error("Invalid media key"), { status: 400 });
  }
  const root = storageRoot();
  const abs = path.resolve(root, rel);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) {
    throw Object.assign(new Error("Invalid media key"), { status: 400 });
  }
  return abs;
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

function clientError(message: string, status = 400, code?: string): never {
  throw Object.assign(new Error(message), { status, code });
}

/**
 * Resolve canonical MIME from magic bytes; reject executables / mismatch.
 * Client Content-Type is a hint only.
 */
export function resolveStoryUploadMime(
  buffer: Buffer,
  claimedMime: string
): { mime: string; kind: "image" | "video" } {
  if (!buffer.length) clientError("Empty file", 400, "EMPTY_FILE");
  if (isExecutableOrScriptMagic(buffer)) {
    clientError("Unsupported file type", 400, "UNSUPPORTED_MEDIA");
  }
  const sniffed = detectMediaMimeFromBytes(buffer);
  if (!sniffed) {
    clientError("Unsupported or corrupt media", 400, "UNSUPPORTED_MEDIA");
  }
  const claimed = claimedMime.toLowerCase().trim().split(";")[0]!.trim();
  const isImage = ALLOWED_IMAGE.has(sniffed);
  const isVideo = ALLOWED_VIDEO.has(sniffed) || sniffed === "video/quicktime";
  // Normalize quicktime container to mp4 storage when sniff says qt (legacy phones).
  const mime = sniffed === "video/quicktime" ? "video/mp4" : sniffed;
  if (!isImage && !isVideo) {
    clientError("Unsupported file type", 400, "UNSUPPORTED_MEDIA");
  }
  if (claimed) {
    const claimedImage = claimed.startsWith("image/");
    const claimedVideo = claimed.startsWith("video/");
    if (claimedImage && !isImage) {
      clientError("Media type does not match upload", 400, "MIME_MISMATCH");
    }
    if (claimedVideo && !isVideo) {
      clientError("Media type does not match upload", 400, "MIME_MISMATCH");
    }
  }
  if (isImage && buffer.length > IMAGE_MAX_BYTES) {
    clientError("Image size exceeds 2 MB (compress before upload)", 400, "IMAGE_TOO_LARGE");
  }
  if (isVideo && buffer.length > VIDEO_MAX_BYTES) {
    clientError("Video size exceeds 50 MB (compress before upload)", 400, "VIDEO_TOO_LARGE");
  }
  return { mime: isVideo ? mime : sniffed, kind: isImage ? "image" : "video" };
}

export type SaveStoryFileResult = {
  key: string;
  absolutePath: string;
  byteSize: number;
  mimeType: string;
  kind: "image" | "video";
  durationSeconds: number | null;
};

/**
 * Persist story bytes under storage/stories/{userId}/{yyyy}/{mm}/tmp_{file}.
 * Videos are ffprobe-validated before the function returns (file deleted on failure).
 */
export async function saveStoryFile(
  userId: number,
  buffer: Buffer,
  mimeType: string
): Promise<SaveStoryFileResult> {
  const { mime, kind } = resolveStoryUploadMime(buffer, mimeType);

  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const fileName = `${STORY_UPLOAD_TMP_PREFIX}${uniqueBaseName()}${extensionForMime(mime)}`;
  const relInside = path.join(String(userId), yyyy, mm, fileName);
  const abs = path.join(storageRoot(), relInside);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, buffer, { flag: "wx" });

  const key = `${LOCAL_STORY_KEY_PREFIX}${relInside.split(path.sep).join("/")}`;

  let durationSeconds: number | null = null;
  if (kind === "video") {
    try {
      durationSeconds = await assertStoryVideoDuration(abs);
    } catch (e) {
      await fs.promises.unlink(abs).catch(() => undefined);
      throw e;
    }
  }

  return {
    key,
    absolutePath: abs,
    byteSize: buffer.length,
    mimeType: mime,
    kind,
    durationSeconds
  };
}

/**
 * Probe video on disk; reject outside [MIN, MAX] or if ffprobe unavailable/fails.
 */
export async function assertStoryVideoDuration(absolutePath: string): Promise<number> {
  const { hasFfmpeg, probeVideoFile } = await import("../utils/videoProcessor");
  if (!(await hasFfmpeg())) {
    console.error("[stories] ffprobe unavailable — cannot validate story video duration");
    clientError("Video validation unavailable. Try again later.", 503, "VIDEO_PROBE_UNAVAILABLE");
  }
  let probe;
  try {
    probe = await probeVideoFile(absolutePath);
  } catch (e: unknown) {
    console.warn("[stories] media inspection failed", {
      code: "VIDEO_PROBE_FAILED",
      message: e instanceof Error ? e.message.slice(0, 120) : "unknown"
    });
    clientError("Invalid or corrupt video", 400, "INVALID_VIDEO");
  }
  const d = Number(probe.durationSec);
  if (!Number.isFinite(d) || d <= 0) {
    console.warn("[stories] rejected media duration — undetermined", { code: "DURATION_UNKNOWN" });
    clientError("Could not determine video duration", 400, "DURATION_UNKNOWN");
  }
  if (d < STORY_VIDEO_MIN_DURATION_SEC) {
    console.info("[stories] rejected media duration", {
      code: "VIDEO_TOO_SHORT",
      durationSec: Math.round(d * 100) / 100
    });
    clientError(
      `Videos must be at least ${STORY_VIDEO_MIN_DURATION_SEC} seconds.`,
      400,
      "VIDEO_TOO_SHORT"
    );
  }
  if (d > STORY_VIDEO_MAX_DURATION_SEC + 0.05) {
    console.info("[stories] rejected media duration", {
      code: "VIDEO_TOO_LONG",
      durationSec: Math.round(d * 100) / 100
    });
    clientError(
      `Videos must be ${STORY_VIDEO_MAX_DURATION_SEC} seconds or less.`,
      400,
      "VIDEO_TOO_LONG"
    );
  }
  return Math.floor(d);
}

export function isPendingStoryUploadKey(key: string): boolean {
  if (!isLocalStoryKey(key)) return false;
  return path.basename(key).startsWith(STORY_UPLOAD_TMP_PREFIX);
}

/**
 * Rename tmp_* upload to permanent name once a Story row owns it.
 * Idempotent if already promoted.
 */
export async function promoteStoryUploadKey(relativeKey: string): Promise<string> {
  if (!isLocalStoryKey(relativeKey)) {
    clientError("Invalid story media reference", 400, "INVALID_STORY_MEDIA");
  }
  if (!isPendingStoryUploadKey(relativeKey)) {
    return relativeKey;
  }
  const abs = absolutePathForStoryKey(relativeKey);
  const dir = path.dirname(abs);
  const base = path.basename(abs);
  const promotedBase = base.slice(STORY_UPLOAD_TMP_PREFIX.length);
  if (!promotedBase) {
    clientError("Invalid story media reference", 400, "INVALID_STORY_MEDIA");
  }
  const promotedAbs = path.join(dir, promotedBase);
  await fs.promises.rename(abs, promotedAbs);
  const relInside = path.relative(storageRoot(), promotedAbs).split(path.sep).join("/");
  return `${LOCAL_STORY_KEY_PREFIX}${relInside}`;
}

export async function deleteStoryFile(relativeKey: string | null | undefined): Promise<boolean> {
  if (!relativeKey || !isLocalStoryKey(relativeKey)) return false;
  try {
    const abs = absolutePathForStoryKey(relativeKey);
    await fs.promises.unlink(abs);
    return true;
  } catch (e: any) {
    if (e?.code === "ENOENT") return false;
    console.warn("[stories-storage] delete failed", {
      code: e?.code,
      message: e?.message ?? String(e)
    });
    return false;
  }
}

export function assertOwnedLocalStoryKey(userId: number, key: string): void {
  const expected = `${LOCAL_STORY_KEY_PREFIX}${userId}/`;
  if (!isLocalStoryKey(key) || !key.startsWith(expected)) {
    throw Object.assign(new Error("Invalid story media reference"), {
      status: 400,
      code: "INVALID_STORY_MEDIA"
    });
  }
}

export type StoryMediaKind = "file" | "thumbnail";

function signPayload(storyId: number, viewerId: number, kind: StoryMediaKind, exp: number): string {
  const payload = `${storyId}.${viewerId}.${kind}.${exp}`;
  return crypto.createHmac("sha256", mediaSigningSecret()).update(payload).digest("hex");
}

export function buildSignedStoryMediaPath(
  storyId: number,
  viewerId: number,
  kind: StoryMediaKind = "file"
): string {
  const exp = Math.floor(Date.now() / 1000) + MEDIA_URL_TTL_SEC;
  const s = signPayload(storyId, viewerId, kind, exp);
  return `/api/stories/${storyId}/${kind === "thumbnail" ? "thumbnail" : "file"}?v=${viewerId}&e=${exp}&s=${s}`;
}

export function verifySignedStoryMediaQuery(opts: {
  storyId: number;
  viewerId: number;
  kind: StoryMediaKind;
  exp: string | undefined;
  sig: string | undefined;
}): boolean {
  const expNum = Number(opts.exp);
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return false;
  if (!opts.sig || typeof opts.sig !== "string" || opts.sig.length < 32) return false;
  let expected: string;
  try {
    expected = signPayload(opts.storyId, opts.viewerId, opts.kind, expNum);
  } catch {
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(opts.sig));
  } catch {
    return false;
  }
}

export async function readStoryFileStream(relativeKey: string): Promise<{
  absolutePath: string;
  stat: fs.Stats;
}> {
  const abs = absolutePathForStoryKey(relativeKey);
  const stat = await fs.promises.stat(abs);
  if (!stat.isFile()) {
    throw Object.assign(new Error("Story media not found"), { status: 404 });
  }
  return { absolutePath: abs, stat };
}

export function mimeFromStoryKey(key: string, fallback = "application/octet-stream"): string {
  const ext = path.extname(key).toLowerCase();
  if (ext === ".webp") return "image/webp";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".mp4") return "video/mp4";
  return fallback;
}

export type OrphanCleanupResult = {
  scanned: number;
  deleted: number;
  failures: number;
};

/**
 * Delete abandoned tmp_* uploads older than maxAgeHours.
 * Never deletes files still referenced by a Story row (caller passes ref set).
 */
export async function cleanupOrphanStoryUploads(opts: {
  referencedKeys: Set<string>;
  maxAgeHours?: number;
}): Promise<OrphanCleanupResult> {
  const maxAgeHours = opts.maxAgeHours ?? STORY_UPLOAD_ORPHAN_MAX_AGE_HOURS;
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  const root = storageRoot();
  const result: OrphanCleanupResult = { scanned: 0, deleted: 0, failures: 0 };

  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (e: any) {
      if (e?.code === "ENOENT") return;
      result.failures += 1;
      return;
    }
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!ent.name.startsWith(STORY_UPLOAD_TMP_PREFIX)) continue;
      result.scanned += 1;
      try {
        const st = await fs.promises.stat(abs);
        if (st.mtimeMs > cutoff) continue;
        const relInside = path.relative(root, abs).split(path.sep).join("/");
        const key = `${LOCAL_STORY_KEY_PREFIX}${relInside}`;
        if (opts.referencedKeys.has(key)) continue;
        await fs.promises.unlink(abs);
        result.deleted += 1;
      } catch {
        result.failures += 1;
      }
    }
  }

  await walk(root);
  console.info("[stories-orphan-cleanup]", {
    scanned: result.scanned,
    deleted: result.deleted,
    failures: result.failures,
    maxAgeHours
  });
  return result;
}
