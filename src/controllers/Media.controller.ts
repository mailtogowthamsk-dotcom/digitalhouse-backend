import { Response } from "express";
import { mediaService } from "../services/Media.service";
import { success, error } from "../utils/response";
import { validateUploadUrlBody, validateFinalizeMediaBody, validateDeleteMediaBody } from "../validations/media.validation";
import { mediaJobService } from "../services/MediaJob.service";
import type { User, MediaModule } from "../models";

type AuthRequest = { user?: User; body?: unknown; params?: Record<string, string> };

function httpError(errorValue: unknown): (Error & { status?: number }) | null {
  return errorValue instanceof Error
    ? (errorValue as Error & { status?: number })
    : null;
}

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
      body.module as MediaModule,
      body.purpose
    );
    return success(res, data, 201);
  } catch (e: unknown) {
    const cause = httpError(e);
    if (cause?.status === 400) return error(res, cause.message, 400);
    throw e;
  }
}

/**
 * POST /api/media/finalize
 * Validate the direct R2 upload and enqueue processing. No Sharp/FFmpeg work
 * runs in the Express request lifecycle.
 */
export async function finalizeUpload(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const body = validateFinalizeMediaBody(req.body);
  try {
    const data = await mediaJobService.enqueueMediaFinalize(
      body.mediaFileId,
      req.user.id
    );
    return success(res, data);
  } catch (e: unknown) {
    const cause = httpError(e);
    const status = cause?.status ?? 500;
    if (status >= 400 && status < 500) {
      return error(res, cause?.message ?? "Request failed", status);
    }
    throw e;
  }
}

/** Poll the durable processing state until the worker completes the job. */
export async function getFinalizeStatus(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const mediaFileId = Number(req.params?.mediaFileId);
  if (!Number.isInteger(mediaFileId) || mediaFileId <= 0) {
    return error(res, "Invalid media file id", 400);
  }
  try {
    const data = await mediaJobService.getMediaFinalizeStatus(mediaFileId, req.user.id);
    return success(res, data);
  } catch (e: unknown) {
    const cause = httpError(e);
    const status = cause?.status ?? 500;
    if (status >= 400 && status < 500) {
      return error(res, cause?.message ?? "Request failed", status);
    }
    throw e;
  }
}

/**
 * POST /api/media/delete
 * Remove uploaded image(s) from R2 when the user clears / removes them.
 */
export async function deleteMedia(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  try {
    const body = validateDeleteMediaBody(req.body);
    const data = await mediaService.deleteUserMediaUrls(req.user.id, body.urls);
    return success(res, data);
  } catch (e: unknown) {
    const cause = httpError(e);
    if (cause?.status) return error(res, cause.message, cause.status);
    throw e;
  }
}
