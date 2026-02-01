import { Response } from "express";
import { mediaService } from "../services/Media.service";
import { success, error } from "../utils/response";
import { validateUploadUrlBody } from "../validations/media.validation";
import type { User, MediaModule } from "../models";

type AuthRequest = { user?: User; body?: unknown };

/**
 * POST /api/media/upload-url
 * Generate pre-signed PUT URL and CDN public URL for direct upload to R2.
 * Backend never receives file bytes; client uploads directly to R2.
 */
export async function getUploadUrl(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const body = validateUploadUrlBody(req.body);
  try {
    const data = await mediaService.generateUploadUrl(
      req.user.id,
      body.fileName,
      body.fileType,
      body.fileSize,
      body.module as MediaModule
    );
    return success(res, data, 201);
  } catch (e: any) {
    if (e?.status === 400) return error(res, e.message, 400);
    throw e;
  }
}
