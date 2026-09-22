/**
 * Local-disk storage for ephemeral Stories media (NOT R2).
 * Files live under STORIES_STORAGE_DIR and are hard-deleted on expiry/owner delete.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  ALLOWED_IMAGE_MIMES,
  ALLOWED_VIDEO_MIMES,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES
} from "../validations/media.validation";

export const LOCAL_STORY_KEY_PREFIX = "local/stories/";

const DEFAULT_STORAGE_DIR = path.join(process.cwd(), "storage", "stories");

/** Signed media URL lifetime for Image/Video players (no Authorization header). */
const MEDIA_URL_TTL_SEC = Number(process.env.STORIES_MEDIA_URL_TTL_SEC || 6 * 60 * 60);

function storageRoot(): string {
  const raw = (process.env.STORIES_STORAGE_DIR || "").trim();
  return path.resolve(raw || DEFAULT_STORAGE_DIR);
}

function mediaSigningSecret(): string {
  return (
    process.env.STORIES_MEDIA_SIGNING_SECRET?.trim() ||
    process.env.JWT_ACCESS_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    "dev-stories-media-secret"
  );
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
  if (m === "image/gif") return ".gif";
  if (m === "video/mp4" || m === "video/x-m4v" || m === "video/m4v") return ".mp4";
  if (m === "video/quicktime") return ".mp4";
  return ".bin";
}

function uniqueBaseName(): string {
  return `${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

export type SaveStoryFileResult = {
  key: string;
  absolutePath: string;
  byteSize: number;
  mimeType: string;
};

/**
 * Persist story bytes under storage/stories/{userId}/{yyyy}/{mm}/{file}.
 * Returns a DB-safe key: local/stories/{userId}/{yyyy}/{mm}/{file}
 */
export async function saveStoryFile(
  userId: number,
  buffer: Buffer,
  mimeType: string
): Promise<SaveStoryFileResult> {
  const mime = mimeType.toLowerCase().trim();
  const isImage = (ALLOWED_IMAGE_MIMES as Set<string>).has(mime);
  const isVideo = (ALLOWED_VIDEO_MIMES as Set<string>).has(mime);
  if (!isImage && !isVideo) {
    throw Object.assign(new Error("Unsupported file type"), { status: 400 });
  }
  if (isImage && buffer.length > IMAGE_MAX_BYTES) {
    throw Object.assign(new Error("Image size exceeds 2 MB (compress before upload)"), {
      status: 400
    });
  }
  if (isVideo && buffer.length > VIDEO_MAX_BYTES) {
    throw Object.assign(new Error("Video size exceeds 50 MB (compress before upload)"), {
      status: 400
    });
  }
  if (!buffer.length) {
    throw Object.assign(new Error("Empty file"), { status: 400 });
  }

  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const fileName = `${uniqueBaseName()}${extensionForMime(mime)}`;
  const relInside = path.join(String(userId), yyyy, mm, fileName);
  const abs = path.join(storageRoot(), relInside);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, buffer, { flag: "wx" });

  const key = `${LOCAL_STORY_KEY_PREFIX}${relInside.split(path.sep).join("/")}`;
  return { key, absolutePath: abs, byteSize: buffer.length, mimeType: mime };
}

/** Permanently delete a local story media file (best-effort). */
export async function deleteStoryFile(relativeKey: string | null | undefined): Promise<boolean> {
  if (!relativeKey || !isLocalStoryKey(relativeKey)) return false;
  try {
    const abs = absolutePathForStoryKey(relativeKey);
    await fs.promises.unlink(abs);
    return true;
  } catch (e: any) {
    if (e?.code === "ENOENT") return false;
    console.warn("[stories-storage] delete failed", relativeKey, e?.message ?? e);
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

/**
 * Relative URL under the API host (mobile getImageUrl prepends server origin).
 * Example: /api/stories/12/file?v=1&e=...&s=...
 */
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
  const expected = signPayload(opts.storyId, opts.viewerId, opts.kind, expNum);
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
  if (ext === ".gif") return "image/gif";
  if (ext === ".mp4") return "video/mp4";
  return fallback;
}
