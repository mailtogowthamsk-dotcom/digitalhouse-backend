/**
 * Media upload URL generation and metadata.
 * Backend NEVER handles file bytes; client uploads directly to R2 via pre-signed URL.
 */

import path from "path";
import { Op } from "sequelize";
import {
  getPresignedPutUrl,
  getCdnPublicUrl,
  extractR2KeyFromUrl,
  deleteMediaArtifacts,
  deleteR2ObjectByKey,
  toPublicUrlIfR2,
  isPrivateR2Object,
  toPrivateSignedUrlIfR2
} from "../utils/r2Client";
import {
  imageStagingCandidatesFromFullKey,
  videoStagingKeyFromOptimized,
  collectMediaArtifactKeys
} from "../utils/mediaArtifactKeys";
import { MediaFile, MediaJob, Post, User } from "../models";
import type { MediaModule, MediaFileType } from "../models";
import {
  ALLOWED_IMAGE_MIMES,
  ALLOWED_VIDEO_MIMES,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES
} from "../validations/media.validation";
import { parseMarketplaceGallery } from "../utils/marketplaceGallery";
import { UserProfile } from "../models/UserProfile.model";
import { needsUploadQuarantine, toQuarantineKey } from "./contentSafety/quarantine";

const R2_PREFIX = "digital-house";

/** Infer file type from MIME for DB and folder logic */
function inferFileType(mime: string): MediaFileType {
  const lower = mime.toLowerCase();
  if ((ALLOWED_IMAGE_MIMES as Set<string>).has(lower)) return "image";
  if ((ALLOWED_VIDEO_MIMES as Set<string>).has(lower)) return "video";
  throw new Error("Unsupported file type");
}

export type MediaUploadPurpose =
  | "image"
  | "video"
  | "video_thumbnail"
  | "profile"
  | "hero"
  | "gallery"
  | "horoscope"
  | "identity"
  | "support"
  | "chat";

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
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");

  if (purpose === "horoscope") {
    return `${R2_PREFIX}/private/horoscopes/${userId}/${yyyy}/${mm}/${safeName}`;
  }
  if (purpose === "identity") {
    return `${R2_PREFIX}/private/ids/${userId}/${yyyy}/${mm}/${safeName}`;
  }
  if (purpose === "support" || purpose === "chat") {
    return `${R2_PREFIX}/private/${purpose}/${userId}/${yyyy}/${mm}/${safeName}`;
  }
  if (module === "profile") {
    // Keep legacy folder so existing profile-photo-upload-url and media/upload-url stay aligned.
    const key = `${R2_PREFIX}/profile-photos/${userId}/${safeName}`;
    return needsUploadQuarantine(module, purpose) ? toQuarantineKey(key) : key;
  }

  if (module === "prominent") {
    const kind =
      purpose === "hero" || purpose === "gallery" || purpose === "profile" ? purpose : "profile";
    return `${R2_PREFIX}/images/prominent/${kind}/${yyyy}/${mm}/${safeName}`;
  }

  if (module === "advertisements") {
    if (fileTypeKind === "video") {
      return `${R2_PREFIX}/videos/advertisements/${yyyy}/${mm}/${safeName}`;
    }
    return `${R2_PREFIX}/images/advertisements/${yyyy}/${mm}/${safeName}`;
  }

  const resolvedPurpose: MediaUploadPurpose =
    purpose ??
    (fileTypeKind === "video"
      ? "video"
      : /vid[_-]?thumb/i.test(originalFileName || uniqueName)
        ? "video_thumbnail"
        : "image");

  let publicKey: string;
  if (resolvedPurpose === "video") {
    publicKey = `${R2_PREFIX}/videos/posts/${yyyy}/${mm}/${safeName}`;
  } else if (resolvedPurpose === "video_thumbnail") {
    publicKey = `${R2_PREFIX}/videos/thumbnails/${yyyy}/${mm}/${safeName}`;
  } else {
    publicKey = `${R2_PREFIX}/images/posts/${module}/${yyyy}/${mm}/${safeName}`;
  }
  return needsUploadQuarantine(module, purpose) ? toQuarantineKey(publicKey) : publicKey;
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
  // New uploads should be mp4; keep .mov key only if legacy mime slips through.
  if (lower === "video/quicktime") return base + ".mp4";
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
    throw Object.assign(new Error("Image size exceeds 2 MB (compress before upload)"), {
      status: 400
    });
  }
  if (fileTypeKind === "video" && fileSize > VIDEO_MAX_BYTES) {
    throw Object.assign(new Error("Video size exceeds 50 MB (compress before upload)"), {
      status: 400
    });
  }

  const uploadMime =
    fileTypeKind === "image" && !mime.includes("webp") ? "image/webp" : mime;
  const uniqueName = uniqueFileName(fileName, uploadMime);
  const key = buildKey(module, userId, uniqueName, fileTypeKind, fileName, purpose);
  const uploadUrl = await getPresignedPutUrl(key, uploadMime);
  // Keep the response field for compatibility, but never construct a public-CDN
  // URL for private media. Callers persist this object key and retrieval signs it.
  const publicUrl = isPrivateR2Object(key) ? key : getCdnPublicUrl(key);

  const mediaFile = await MediaFile.create({
    userId,
    module,
    // Store the object key; the CDN URL is derived at read time.
    fileUrl: key,
    fileType: fileTypeKind,
    status: "PENDING",
    objectKey: key,
    processingStatus: "pending"
  });

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
    attributes: ["id", "userId", "module", "fileUrl", "fileType", "objectKey", "createdAt"]
  });
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      userId: r.userId,
      module: r.module,
      fileUrl: isPrivateR2Object(r.objectKey ?? r.fileUrl)
        ? (await toPrivateSignedUrlIfR2(r.objectKey ?? r.fileUrl)) ?? ""
        : toPublicUrlIfR2(r.fileUrl) ?? r.fileUrl,
      fileType: r.fileType,
      createdAt: r.createdAt
    }))
  );
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

  // Profile photo (live + pending replacement for registration corrections)
  const user = await User.findByPk(userId, {
    attributes: ["profilePhoto", "pendingProfilePhoto"]
  });
  if (user?.profilePhoto && extractR2KeyFromUrl(user.profilePhoto) === key) return true;
  if (user?.profilePhoto && user.profilePhoto.includes(baseName)) return true;
  if (user?.pendingProfilePhoto && extractR2KeyFromUrl(user.pendingProfilePhoto) === key) {
    return true;
  }
  if (user?.pendingProfilePhoto && user.pendingProfilePhoto.includes(baseName)) return true;

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
 * Delete abandoned / leftover media safely.
 *
 * 1) PENDING rows older than threshold, no active job, unreferenced → full artifact delete + row
 * 2) FAILED processing leftovers (PENDING/REJECTED), same gates → full artifact delete + row
 * 3) COMPLETED rows: best-effort delete derived staging leftovers (_full.webp → .webp/.jpg…,
 *    *_opt.mp4 → original .mp4) when those keys are not the live objectKey / variants
 *
 * Never deletes processing/pending jobs' objects. Prefer leaving an object over deleting
 * valid data. Does not list the whole R2 bucket — only DB-derived candidate keys.
 */
export async function cleanupOrphanPendingMedia(opts?: {
  olderThanHours?: number;
  limit?: number;
}): Promise<{ scanned: number; deleted: number; stagingCleared: number }> {
  const olderThanHours = Math.max(1, opts?.olderThanHours ?? 24);
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

  let scanned = 0;
  let deleted = 0;
  let stagingCleared = 0;

  const pendingRows = await MediaFile.findAll({
    where: {
      status: "PENDING",
      createdAt: { [Op.lt]: cutoff }
    },
    order: [["createdAt", "ASC"]],
    limit
  });
  scanned += pendingRows.length;

  for (const row of pendingRows) {
    const removed = await tryDeleteOrphanMediaRow(row);
    if (removed) deleted += 1;
  }

  const failedRows = await MediaFile.findAll({
    where: {
      processingStatus: "failed",
      status: { [Op.in]: ["PENDING", "REJECTED"] },
      updatedAt: { [Op.lt]: cutoff }
    },
    order: [["updatedAt", "ASC"]],
    limit
  });
  scanned += failedRows.length;

  for (const row of failedRows) {
    const removed = await tryDeleteOrphanMediaRow(row);
    if (removed) deleted += 1;
  }

  // Historical staging leftovers after successful optimize (pre-hardening or failed delete).
  const completedRows = await MediaFile.findAll({
    where: {
      processingStatus: "completed",
      updatedAt: { [Op.lt]: cutoff }
    },
    order: [["updatedAt", "ASC"]],
    limit
  });
  scanned += completedRows.length;

  for (const row of completedRows) {
    const activeJob = await MediaJob.count({
      where: { mediaId: row.id, status: { [Op.in]: ["pending", "processing"] } }
    });
    if (activeJob > 0) continue;

    const objectKey = row.objectKey || extractR2KeyFromUrl(row.fileUrl);
    const keep = new Set<string>();
    if (objectKey) keep.add(objectKey);
    if (row.fileUrl) {
      const fk = extractR2KeyFromUrl(row.fileUrl);
      if (fk) keep.add(fk);
    }
    if (row.variantsJson) {
      try {
        const parsed = JSON.parse(row.variantsJson) as Record<string, unknown>;
        for (const v of Object.values(parsed)) {
          if (typeof v === "string" && v.startsWith("digital-house/")) keep.add(v);
        }
      } catch {
        /* ignore */
      }
    }

    const candidates: string[] = [];
    if (objectKey?.endsWith("_full.webp")) {
      for (const s of imageStagingCandidatesFromFullKey(objectKey)) {
        if (!keep.has(s)) candidates.push(s);
      }
    }
    if (objectKey?.endsWith("_opt.mp4")) {
      const staging = videoStagingKeyFromOptimized(objectKey);
      if (staging && !keep.has(staging)) candidates.push(staging);
    }

    for (const key of [...new Set(candidates)]) {
      await deleteR2ObjectByKey(key);
      stagingCleared += 1;
    }
  }

  return { scanned, deleted, stagingCleared };
}

async function tryDeleteOrphanMediaRow(row: MediaFile): Promise<boolean> {
  const activeJob = await MediaJob.count({
    where: { mediaId: row.id, status: { [Op.in]: ["pending", "processing"] } }
  });
  if (activeJob > 0) return false;

  const key = row.objectKey || extractR2KeyFromUrl(row.fileUrl);
  if (!key) {
    await row.destroy().catch(() => undefined);
    return true;
  }

  const referenced = await userReferencesMediaKey(row.userId, key);
  if (referenced) {
    if (row.status === "PENDING") {
      await row.update({ status: "APPROVED" }).catch(() => undefined);
    }
    return false;
  }

  // Also refuse if any variant/staging candidate is referenced.
  for (const artifact of collectMediaArtifactKeys(key, row.variantsJson)) {
    if (artifact === key) continue;
    if (await userReferencesMediaKey(row.userId, artifact)) {
      if (row.status === "PENDING") {
        await row.update({ status: "APPROVED" }).catch(() => undefined);
      }
      return false;
    }
  }

  await deleteMediaArtifacts(key, row.variantsJson);
  await row.destroy().catch(() => undefined);
  return true;
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
      throw Object.assign(new Error("Not allowed to delete this media"), {
        status: 403
      });
    }

    await deleteMediaArtifacts(key, mediaRow?.variantsJson);
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
  await Promise.all(toDelete.map((key) => deleteMediaArtifacts(key)));
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
