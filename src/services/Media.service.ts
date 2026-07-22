/**
 * Media upload URL generation and metadata.
 * Backend NEVER handles file bytes; client uploads directly to R2 via pre-signed URL.
 */

import path from "path";
import { Op } from "sequelize";
import { getPresignedPutUrl, getCdnPublicUrl, extractR2KeyFromUrl, deleteR2ImageVariants } from "../utils/r2Client";
import { MediaFile, Post, User } from "../models";
import type { MediaModule, MediaFileType } from "../models";
import {
  ALLOWED_IMAGE_MIMES,
  ALLOWED_VIDEO_MIMES,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES
} from "../validations/media.validation";
import { parseMarketplaceGallery } from "../utils/marketplaceGallery";
import { UserProfile } from "../models/UserProfile.model";

const R2_PREFIX = "digital-house";

/** Infer file type from MIME for DB and folder logic */
function inferFileType(mime: string): MediaFileType {
  const lower = mime.toLowerCase();
  if ((ALLOWED_IMAGE_MIMES as Set<string>).has(lower)) return "image";
  if ((ALLOWED_VIDEO_MIMES as Set<string>).has(lower)) return "video";
  throw new Error("Unsupported file type");
}

export type MediaUploadPurpose = "image" | "video" | "video_thumbnail";

/** Build R2 object key from module and user; prevents path traversal. */
function buildKey(
  module: MediaModule,
  userId: number,
  uniqueName: string,
  fileTypeKind: MediaFileType,
  originalFileName?: string,
  purpose?: MediaUploadPurpose
): string {
  const safeName = path.basename(uniqueName).replace(/[^a-zA-Z0-9._-]/g, "_");
  if (module === "profile") {
    // Keep legacy folder so existing profile-photo-upload-url and media/upload-url stay aligned.
    return `${R2_PREFIX}/profile-photos/${userId}/${safeName}`;
  }

  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");

  const resolvedPurpose: MediaUploadPurpose =
    purpose ??
    (fileTypeKind === "video"
      ? "video"
      : /vid[_-]?thumb/i.test(originalFileName || uniqueName)
        ? "video_thumbnail"
        : "image");

  if (resolvedPurpose === "video") {
    return `${R2_PREFIX}/videos/posts/${yyyy}/${mm}/${safeName}`;
  }
  if (resolvedPurpose === "video_thumbnail") {
    return `${R2_PREFIX}/videos/thumbnails/${yyyy}/${mm}/${safeName}`;
  }

  return `${R2_PREFIX}/images/posts/${module}/${yyyy}/${mm}/${safeName}`;
}

/** Generate unique filename: timestamp + random to avoid collisions */
function uniqueFileName(originalName: string, mime: string): string {
  const base = Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  const lower = mime.toLowerCase();
  if ((ALLOWED_IMAGE_MIMES as Set<string>).has(lower)) {
    return base + ".webp";
  }
  if (lower === "video/mp4" || lower === "video/x-m4v" || lower === "video/m4v") {
    return base + ".mp4";
  }
  if (lower === "video/quicktime") return base + ".mov";
  const ext = path.extname(originalName) || "";
  return base + (ext.toLowerCase() || ".bin");
}

export type UploadUrlResult = {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  mediaFileId: number;
};

/**
 * Generate pre-signed PUT URL and CDN public URL; create PENDING media_files row.
 * Client uploads file to uploadUrl via PUT; stores publicUrl in post/profile.
 */
export async function generateUploadUrl(
  userId: number,
  fileName: string,
  fileType: string,
  fileSize: number,
  module: MediaModule,
  purpose?: MediaUploadPurpose
): Promise<UploadUrlResult> {
  const mime = fileType.toLowerCase().trim();
  const fileTypeKind = inferFileType(mime);
  if (fileTypeKind === "image" && fileSize > IMAGE_MAX_BYTES) {
    const err = new Error("Image size exceeds 2 MB (compress before upload)");
    (err as any).status = 400;
    throw err;
  }
  if (fileTypeKind === "video" && fileSize > VIDEO_MAX_BYTES) {
    const err = new Error("Video size exceeds 50 MB (compress before upload)");
    (err as any).status = 400;
    throw err;
  }

  const uploadMime =
    fileTypeKind === "image" && !mime.includes("webp") ? "image/webp" : mime;
  const uniqueName = uniqueFileName(fileName, uploadMime);
  const key = buildKey(module, userId, uniqueName, fileTypeKind, fileName, purpose);
  const [uploadUrl, publicUrl] = await Promise.all([
    getPresignedPutUrl(key, uploadMime),
    Promise.resolve(getCdnPublicUrl(key))
  ]);

  const mediaFile = await MediaFile.create({
    userId,
    module,
    fileUrl: publicUrl,
    fileType: fileTypeKind,
    status: "PENDING",
    objectKey: key,
    processingStatus: fileTypeKind === "image" ? "pending_upload" : "ready"
  } as any);

  return {
    uploadUrl,
    publicUrl,
    key,
    mediaFileId: mediaFile.id
  };
}

/** List media files with status PENDING (for admin moderation) */
export async function listPendingMedia(): Promise<
  { id: number; userId: number; module: string; fileUrl: string; fileType: string; createdAt: Date }[]
> {
  const rows = await MediaFile.findAll({
    where: { status: "PENDING" },
    order: [["createdAt", "DESC"]],
    attributes: ["id", "userId", "module", "fileUrl", "fileType", "createdAt"]
  });
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    module: r.module,
    fileUrl: r.fileUrl,
    fileType: r.fileType,
    createdAt: r.createdAt
  }));
}

/** Admin: approve media (status → APPROVED) */
export async function approveMedia(mediaId: number): Promise<void> {
  const row = await MediaFile.findByPk(mediaId);
  if (!row) throw new Error("Media not found");
  if (row.status !== "PENDING") throw new Error("Media is not pending");
  await row.update({ status: "APPROVED" });
}

/** Admin: reject media (status → REJECTED) */
export async function rejectMedia(mediaId: number): Promise<void> {
  const row = await MediaFile.findByPk(mediaId);
  if (!row) throw new Error("Media not found");
  if (row.status !== "PENDING") throw new Error("Media is not pending");
  await row.update({ status: "REJECTED" });
}

async function findOwnedMediaFile(userId: number, key: string): Promise<MediaFile | null> {
  const fileName = path.basename(key);
  const baseName = fileName.replace(/_(full|md|thumb)\.webp$/i, "").replace(/\.webp$/i, "");
  return MediaFile.findOne({
    where: {
      userId,
      [Op.or]: [
        { objectKey: key },
        ...(baseName
          ? [
              { objectKey: { [Op.like]: `%/${baseName}%` } },
              { fileUrl: { [Op.like]: `%/${baseName}%` } }
            ]
          : []),
        { fileUrl: { [Op.like]: `%${fileName}%` } }
      ]
    },
    order: [["id", "DESC"]]
  });
}

async function userReferencesMediaKey(userId: number, key: string): Promise<boolean> {
  const baseName = path.basename(key).split(".")[0];
  if (!baseName) return false;

  // Profile photo
  const user = await User.findByPk(userId, { attributes: ["profilePhoto"] });
  if (user?.profilePhoto && extractR2KeyFromUrl(user.profilePhoto) === key) return true;
  if (user?.profilePhoto && user.profilePhoto.includes(baseName)) return true;

  // Matrimony media lives in user_profiles.matrimony JSON
  const profileRow = await UserProfile.findOne({
    where: { userId },
    attributes: ["matrimony"]
  }).catch(() => null);
  const matrimony = profileRow?.matrimony as Record<string, unknown> | null | undefined;
  if (matrimony) {
    const candidates: string[] = [];
    for (const k of ["candidatePhotoUrl", "profilePhotoUrl", "horoscopeDocumentUrl"]) {
      const v = matrimony[k];
      if (typeof v === "string" && v.trim()) candidates.push(v);
    }
    const photos = matrimony.candidatePhotos;
    if (Array.isArray(photos)) {
      for (const p of photos) {
        if (p && typeof p === "object" && typeof (p as { url?: string }).url === "string") {
          candidates.push((p as { url: string }).url);
        }
      }
    }
    if (candidates.some((u) => extractR2KeyFromUrl(u) === key || u.includes(baseName))) {
      return true;
    }
  }

  // Posts — page all of the owner's posts (orphan job is infrequent).
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const posts = await Post.findAll({
      where: { userId },
      attributes: ["mediaUrl", "thumbnailUrl", "marketplaceGallery", "helpGallery"],
      order: [["id", "ASC"]],
      limit: pageSize,
      offset
    });
    if (posts.length === 0) break;

    for (const post of posts) {
      const urls: string[] = [];
      if (post.mediaUrl) urls.push(post.mediaUrl);
      if (post.thumbnailUrl) urls.push(post.thumbnailUrl);
      urls.push(...parseMarketplaceGallery(post.marketplaceGallery, post.mediaUrl ?? null));
      const help = post.helpGallery;
      if (Array.isArray(help)) {
        for (const u of help) {
          if (typeof u === "string" && u.trim()) urls.push(u);
        }
      }
      if (urls.some((u) => extractR2KeyFromUrl(u) === key || u.includes(baseName))) {
        return true;
      }
    }
    if (posts.length < pageSize) break;
  }
  return false;
}

/**
 * Mark media_files as APPROVED once they are attached to a saved post/profile.
 * Prevents the orphan cleanup job from deleting live assets.
 */
export async function markMediaUrlsAttached(
  userId: number,
  urls: Array<string | null | undefined>
): Promise<number> {
  const keys = new Set<string>();
  for (const raw of urls) {
    if (!raw?.trim()) continue;
    const key = extractR2KeyFromUrl(raw.trim());
    if (key) keys.add(key);
  }
  if (keys.size === 0) return 0;

  let updated = 0;
  for (const key of keys) {
    const row = await findOwnedMediaFile(userId, key);
    if (!row) continue;
    if (row.status !== "APPROVED") {
      await row.update({ status: "APPROVED" });
      updated += 1;
    }
  }
  return updated;
}

/**
 * Delete abandoned PENDING uploads older than `olderThanHours` that are not
 * referenced by the owner's profile, matrimony, or posts. Best-effort R2 + DB cleanup.
 */
export async function cleanupOrphanPendingMedia(opts?: {
  olderThanHours?: number;
  limit?: number;
}): Promise<{ scanned: number; deleted: number }> {
  const olderThanHours = Math.max(1, opts?.olderThanHours ?? 24);
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

  const rows = await MediaFile.findAll({
    where: {
      status: "PENDING",
      createdAt: { [Op.lt]: cutoff }
    },
    order: [["createdAt", "ASC"]],
    limit
  });

  let deleted = 0;
  for (const row of rows) {
    const key = row.objectKey || extractR2KeyFromUrl(row.fileUrl);
    if (!key) {
      await row.destroy().catch(() => undefined);
      deleted += 1;
      continue;
    }

    const referenced = await userReferencesMediaKey(row.userId, key);
    if (referenced) {
      // Attached but status never flipped — heal instead of deleting.
      await row.update({ status: "APPROVED" }).catch(() => undefined);
      continue;
    }

    await deleteR2ImageVariants(key);
    await row.destroy().catch(() => undefined);
    deleted += 1;
  }

  return { scanned: rows.length, deleted };
}

/**
 * Delete one or more uploaded images from R2 (all variants) for the owning user.
 * Used when clearing/removing photos before or after save.
 */
export async function deleteUserMediaUrls(
  userId: number,
  urls: string[]
): Promise<{ deleted: number }> {
  let deleted = 0;
  const seen = new Set<string>();

  for (const raw of urls) {
    const key = extractR2KeyFromUrl(raw.trim());
    if (!key || !key.startsWith(`${R2_PREFIX}/`) || seen.has(key)) continue;
    seen.add(key);

    const profileOwned = key.startsWith(`${R2_PREFIX}/profile-photos/${userId}/`);
    const mediaRow = await findOwnedMediaFile(userId, key);
    const postOwned = mediaRow || profileOwned ? true : await userReferencesMediaKey(userId, key);

    if (!profileOwned && !mediaRow && !postOwned) {
      const err = new Error("Not allowed to delete this media");
      (err as any).status = 403;
      throw err;
    }

    await deleteR2ImageVariants(key);
    if (mediaRow) {
      await mediaRow.destroy();
    } else {
      const fileName = path.basename(key);
      const baseName = fileName.replace(/_(full|md|thumb)\.webp$/i, "").replace(/\.webp$/i, "");
      await MediaFile.destroy({
        where: {
          userId,
          [Op.or]: [
            { objectKey: key },
            ...(baseName
              ? [
                  { objectKey: { [Op.like]: `%/${baseName}%` } },
                  { fileUrl: { [Op.like]: `%/${baseName}%` } }
                ]
              : [])
          ]
        }
      });
    }
    deleted += 1;
  }

  return { deleted };
}

/** Delete R2 objects for URLs removed from a listing (owner already verified by caller). */
export async function deleteRemovedMediaUrls(oldUrls: string[], newUrls: string[]): Promise<void> {
  const newKeys = new Set(
    newUrls
      .map((u) => extractR2KeyFromUrl(u.trim()))
      .filter((k): k is string => Boolean(k))
  );
  const toDelete: string[] = [];
  for (const u of oldUrls) {
    const key = extractR2KeyFromUrl(u.trim());
    if (!key || newKeys.has(key)) continue;
    if (!toDelete.includes(key)) toDelete.push(key);
  }
  await Promise.all(toDelete.map((key) => deleteR2ImageVariants(key)));
  for (const key of toDelete) {
    const fileName = path.basename(key);
    const baseName = fileName.replace(/_(full|md|thumb)\.webp$/i, "").replace(/\.webp$/i, "");
    await MediaFile.destroy({
      where: {
        [Op.or]: [
          { objectKey: key },
          ...(baseName
            ? [
                { objectKey: { [Op.like]: `%/${baseName}%` } },
                { fileUrl: { [Op.like]: `%/${baseName}%` } }
              ]
            : [])
        ]
      }
    }).catch(() => {});
  }
}

export const mediaService = {
  generateUploadUrl,
  listPendingMedia,
  approveMedia,
  rejectMedia,
  deleteUserMediaUrls,
  deleteRemovedMediaUrls,
  markMediaUrlsAttached,
  cleanupOrphanPendingMedia
};
