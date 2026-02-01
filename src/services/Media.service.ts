/**
 * Media upload URL generation and metadata.
 * Backend NEVER handles file bytes; client uploads directly to R2 via pre-signed URL.
 */

import path from "path";
import { getPresignedPutUrl, getCdnPublicUrl } from "../utils/r2Client";
import { MediaFile } from "../models";
import type { MediaModule, MediaFileType } from "../models";
import {
  ALLOWED_IMAGE_MIMES,
  ALLOWED_VIDEO_MIMES,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES
} from "../validations/media.validation";

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
    return `${R2_PREFIX}/profile/${userId}/${safeName}`;
  }
  // posts, jobs, marketplace, matrimony, help → under posts/{module}/
  return `${R2_PREFIX}/posts/${module}/${safeName}`;
}

/** Generate unique filename: timestamp + random to avoid collisions */
function uniqueFileName(originalName: string): string {
  const ext = path.extname(originalName) || "";
  const base = Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
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
    const err = new Error("Image size exceeds 5 MB");
    (err as any).status = 400;
    throw err;
  }
  if (fileTypeKind === "video" && fileSize > VIDEO_MAX_BYTES) {
    const err = new Error("Video size exceeds 15 MB");
    (err as any).status = 400;
    throw err;
  }

  const uniqueName = uniqueFileName(fileName);
  const key = buildKey(module, userId, uniqueName);
  const [uploadUrl, publicUrl] = await Promise.all([
    getPresignedPutUrl(key, mime),
    Promise.resolve(getCdnPublicUrl(key))
  ]);

  const mediaFile = await MediaFile.create({
    userId,
    module,
    fileUrl: publicUrl,
    fileType: fileTypeKind,
    status: "PENDING"
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

export const mediaService = {
  generateUploadUrl,
  listPendingMedia,
  approveMedia,
  rejectMedia
};
