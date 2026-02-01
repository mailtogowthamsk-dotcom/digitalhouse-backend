import { z } from "zod";
import { MEDIA_MODULES } from "../models/MediaFile.model";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png"] as const;
const ALLOWED_VIDEO_TYPES = ["video/mp4"] as const;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const VIDEO_MAX_BYTES = 15 * 1024 * 1024; // 15 MB

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
    module: mediaModuleSchema
  })
  .strict()
  .refine(
    (data) => {
      const t = data.fileType.toLowerCase();
      if (ALLOWED_IMAGE_TYPES.includes(t as any)) return data.fileSize <= IMAGE_MAX_BYTES;
      if (ALLOWED_VIDEO_TYPES.includes(t as any)) return data.fileSize <= VIDEO_MAX_BYTES;
      return false;
    },
    {
      message: "Invalid fileType or fileSize: images ≤ 5 MB (jpg, jpeg, png), videos ≤ 15 MB (mp4)"
    }
  );

export type UploadUrlBody = z.infer<typeof uploadUrlSchema>;

export function validateUploadUrlBody(body: unknown): UploadUrlBody {
  return uploadUrlSchema.parse(body);
}

export const ALLOWED_IMAGE_MIMES = new Set(ALLOWED_IMAGE_TYPES);
export const ALLOWED_VIDEO_MIMES = new Set(ALLOWED_VIDEO_TYPES);
export { IMAGE_MAX_BYTES, VIDEO_MAX_BYTES };
