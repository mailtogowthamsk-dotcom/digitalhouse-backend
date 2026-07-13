/**
 * Media upload URL generation and metadata.
 * Backend NEVER handles file bytes; client uploads directly to R2 via pre-signed URL.
 */

import path from "path";
import { Op } from "sequelize";
import { getPresignedPutUrl, getCdnPublicUrl, extractR2KeyFromUrl, deleteR2ImageVariants } from "../utils/r2Client";
import { MediaFile, Post } from "../models";
import type { MediaModule, MediaFileType } from "../models";
import {
  ALLOWED_IMAGE_MIMES,
  ALLOWED_VIDEO_MIMES,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES
} from "../validations/media.validation";
import { parseMarketplaceGallery } from "../utils/marketplaceGallery";

const R2_PREFIX = "digital-house";

/** Infer file type from MIME for DB and folder logic */
function inferFileType(mime: string): MediaFileType {
  const lower = mime.toLowerCase();
  if ((ALLOWED_IMAGE_MIMES as Set<string>).has(lower)) return "image";
  if ((ALLOWED_VIDEO_MIMES as Set<string>).has(lower)) return "video";
  throw new Error("Unsupported file type");
}

/** Build R2 object key from module and user; prevents path traversal. */
function buildKey(module: MediaModule, userId: number, uniqueName: string): string {
  const safeName = path.basename(uniqueName).replace(/[^a-zA-Z0-9._-]/g, "_");
  if (module === "profile") {
    // Use same folder as profile-photo-upload-url so fallback (media/upload-url) and main flow match.
    return `${R2_PREFIX}/profile-photos/${userId}/${safeName}`;
  }
  // posts, jobs, marketplace, matrimony, help → under posts/{module}/
  return `${R2_PREFIX}/posts/${module}/${safeName}`;
}

/** Generate unique filename: timestamp + random to avoid collisions */
function uniqueFileName(originalName: string, mime: string): string {
  const base = Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  const lower = mime.toLowerCase();
  if ((ALLOWED_IMAGE_MIMES as Set<string>).has(lower)) {
    return base + ".webp";
  }
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
  module: MediaModule
): Promise<UploadUrlResult> {
  const mime = fileType.toLowerCase().trim();
  const fileTypeKind = inferFileType(mime);
  if (fileTypeKind === "image" && fileSize > IMAGE_MAX_BYTES) {
    const err = new Error("Image size exceeds 2 MB (compress before upload)");
    (err as any).status = 400;
    throw err;
  }
  if (fileTypeKind === "video" && fileSize > VIDEO_MAX_BYTES) {
    const err = new Error("Video size exceeds 15 MB");
    (err as any).status = 400;
    throw err;
  }

  const uploadMime =
    fileTypeKind === "image" && !mime.includes("webp") ? "image/webp" : mime;
  const uniqueName = uniqueFileName(fileName, uploadMime);
  const key = buildKey(module, userId, uniqueName);
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

async function userReferencesMediaOnOwnPost(userId: number, key: string): Promise<boolean> {
  const posts = await Post.findAll({
    where: { userId },
    attributes: ["mediaUrl", "marketplaceGallery"],
    order: [["updatedAt", "DESC"]],
    limit: 80
  });
  for (const post of posts) {
    const gallery = parseMarketplaceGallery(post.marketplaceGallery, post.mediaUrl ?? null);
    if (gallery.some((u) => extractR2KeyFromUrl(u) === key)) return true;
  }
  return false;
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
    const postOwned = mediaRow || profileOwned ? true : await userReferencesMediaOnOwnPost(userId, key);

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
  deleteRemovedMediaUrls
};
