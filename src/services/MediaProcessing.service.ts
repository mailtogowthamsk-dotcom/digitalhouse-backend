/**
 * Post-upload image processing: download from R2, optimize, store variants, cleanup staging.
 */

import { MediaFile } from "../models";
import {
  extractR2KeyFromUrl,
  getR2ObjectBuffer,
  putR2ObjectBuffer,
  getCdnPublicUrl,
  deleteR2ObjectByKey
} from "../utils/r2Client";
import {
  processImageBuffer,
  sniffImageMime,
  variantKeysFromUploadKey,
  IMAGE_OUTPUT_MIME
} from "../utils/imageProcessor";
import { IMAGE_PROCESS_DOWNLOAD_MAX_BYTES } from "../config/image.config";

export type MediaVariantsDto = {
  thumb: string;
  medium: string;
  full: string;
};

export type FinalizeMediaResult = {
  mediaFileId: number;
  publicUrl: string;
  variants: MediaVariantsDto;
  width: number;
  height: number;
  byteSize: number;
};

const processingLocks = new Set<number>();

/**
 * Process an uploaded image: generate WebP variants, update DB, remove staging object.
 */
export async function finalizeMediaFile(
  mediaFileId: number,
  userId: number
): Promise<FinalizeMediaResult> {
  if (processingLocks.has(mediaFileId)) {
    const err = new Error("Processing already in progress");
    (err as any).status = 409;
    throw err;
  }
  processingLocks.add(mediaFileId);

  try {
    const row = await MediaFile.findByPk(mediaFileId);
    if (!row) {
      const err = new Error("Media not found");
      (err as any).status = 404;
      throw err;
    }
    if (row.userId !== userId) {
      const err = new Error("Forbidden");
      (err as any).status = 403;
      throw err;
    }
    if (row.fileType !== "image") {
      const err = new Error("Only images can be optimized");
      (err as any).status = 400;
      throw err;
    }
    if (row.processingStatus === "ready" && row.variantsJson) {
      const variants = JSON.parse(row.variantsJson) as MediaVariantsDto;
      return {
        mediaFileId: row.id,
        publicUrl: row.fileUrl,
        variants,
        width: row.width ?? 0,
        height: row.height ?? 0,
        byteSize: row.byteSize ?? 0
      };
    }

    await row.update({ processingStatus: "processing" });

    const stagingKey =
      row.objectKey ?? extractR2KeyFromUrl(row.fileUrl);
    if (!stagingKey) {
      const err = new Error("Invalid media storage key");
      (err as any).status = 400;
      throw err;
    }

    const raw = await getR2ObjectBuffer(stagingKey, IMAGE_PROCESS_DOWNLOAD_MAX_BYTES);
    const sniffed = sniffImageMime(raw);
    if (!sniffed) {
      const err = new Error("Unsupported or invalid image file");
      (err as any).status = 400;
      throw err;
    }

    const processed = await processImageBuffer(raw);
    const { thumbKey, mediumKey, fullKey } = variantKeysFromUploadKey(stagingKey);

    await Promise.all([
      putR2ObjectBuffer(thumbKey, processed.thumb.buffer, IMAGE_OUTPUT_MIME),
      putR2ObjectBuffer(mediumKey, processed.medium.buffer, IMAGE_OUTPUT_MIME),
      putR2ObjectBuffer(fullKey, processed.full.buffer, IMAGE_OUTPUT_MIME)
    ]);

    const variants: MediaVariantsDto = {
      thumb: getCdnPublicUrl(thumbKey),
      medium: getCdnPublicUrl(mediumKey),
      full: getCdnPublicUrl(fullKey)
    };

    if (stagingKey !== fullKey && stagingKey !== thumbKey && stagingKey !== mediumKey) {
      await deleteR2ObjectByKey(stagingKey);
    }

    await row.update({
      fileUrl: variants.full,
      objectKey: fullKey,
      variantsJson: JSON.stringify(variants),
      processingStatus: "ready",
      byteSize: processed.full.bytes,
      width: processed.full.width,
      height: processed.full.height
    });

    return {
      mediaFileId: row.id,
      publicUrl: variants.full,
      variants,
      width: processed.full.width,
      height: processed.full.height,
      byteSize: processed.full.bytes
    };
  } catch (e) {
    await MediaFile.update(
      { processingStatus: "failed" },
      { where: { id: mediaFileId, userId } }
    ).catch(() => {});
    throw e;
  } finally {
    processingLocks.delete(mediaFileId);
  }
}

export const mediaProcessingService = {
  finalizeMediaFile
};
