import { z } from "zod";
import { MEDIA_MODULES } from "../models/MediaFile.model";
import {
  ALLOWED_POST_IMAGE_MIMES,
  ALLOWED_POST_VIDEO_MIMES,
  POST_IMAGE_UPLOAD_MAX_BYTES,
  POST_VIDEO_MAX_BYTES
} from "../constants/postMedia.constants";

const ALLOWED_IMAGE_TYPES = ALLOWED_POST_IMAGE_MIMES;
const ALLOWED_VIDEO_TYPES = ALLOWED_POST_VIDEO_MIMES;
const IMAGE_MAX_BYTES = POST_IMAGE_UPLOAD_MAX_BYTES;
const VIDEO_MAX_BYTES = POST_VIDEO_MAX_BYTES;

const mediaModuleSchema = z.enum(MEDIA_MODULES as unknown as [string, ...string[]]);

export const uploadUrlSchema = z
  .object({
    fileName: z
      .string()
      .trim()
      .min(1, "fileName required")
      .max(255)
      .refine((name) => !name.includes("..") && !name.includes("/") && !name.includes("\\"), {
        message: "Invalid fileName: no path traversal"
      }),
    fileType: z.string().trim().min(1, "fileType required"),
    fileSize: z.number().int().positive("fileSize must be positive"),
    module: mediaModuleSchema,
    /**
     * Optional storage purpose for R2 folder layout.
     * video_thumbnail → videos/thumbnails/YYYY/MM/
     * video → videos/posts/YYYY/MM/
     * image (default) → images/posts/{module}/YYYY/MM/
     */
    purpose: z.enum(["image", "video", "video_thumbnail"]).optional()
  })
  .strict()
  .refine(
    (data) => {
      const t = data.fileType.toLowerCase();
      if ((ALLOWED_IMAGE_TYPES as readonly string[]).includes(t)) {
        return data.fileSize <= IMAGE_MAX_BYTES;
      }
      if ((ALLOWED_VIDEO_TYPES as readonly string[]).includes(t)) {
        return data.fileSize <= VIDEO_MAX_BYTES;
      }
      return false;
    },
    {
      message:
        "Invalid fileType or fileSize: images ≤ 2 MB (jpeg, png, webp), videos ≤ 50 MB (mp4, mov, m4v)"
    }
  );

export type UploadUrlBody = z.infer<typeof uploadUrlSchema>;

export function validateUploadUrlBody(body: unknown): UploadUrlBody {
  return uploadUrlSchema.parse(body);
}

const finalizeMediaSchema = z
  .object({
    mediaFileId: z.number().int().positive()
  })
  .strict();

export function validateFinalizeMediaBody(body: unknown): { mediaFileId: number } {
  return finalizeMediaSchema.parse(body);
}

const deleteMediaSchema = z
  .object({
    urls: z.array(z.string().trim().min(1).max(1000)).min(1).max(12)
  })
  .strict();

export function validateDeleteMediaBody(body: unknown): { urls: string[] } {
  return deleteMediaSchema.parse(body);
}

export const ALLOWED_IMAGE_MIMES = new Set<string>(ALLOWED_IMAGE_TYPES);
export const ALLOWED_VIDEO_MIMES = new Set<string>(ALLOWED_VIDEO_TYPES);
export { IMAGE_MAX_BYTES, VIDEO_MAX_BYTES };
