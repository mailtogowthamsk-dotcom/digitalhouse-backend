/**
 * Post-upload media processing: images → WebP variants; videos → H.264/AAC faststart + posters.
 * Runs only in the standalone media worker. Existing completed media is
 * returned as-is (idempotent / backward compatible).
 *
 * Staging originals are NOT deleted here. The media job layer deletes them only
 * after the DB completion transaction succeeds and the worker still owns the claim.
 */

import { MediaFile } from "../models";
import {
  extractR2KeyFromUrl,
  getR2ObjectBuffer,
  getR2ObjectMetadata,
  putR2ObjectBuffer,
  getCdnPublicUrl,
  isPrivateR2Object
} from "../utils/r2Client";
import {
  processImageBuffer,
  sniffImageMime,
  IMAGE_OUTPUT_MIME
} from "../utils/imageProcessor";
import {
  imageVariantKeys,
  videoOptimizedKey,
  videoPosterKeys
} from "../utils/mediaArtifactKeys";
import { IMAGE_PROCESS_DOWNLOAD_MAX_BYTES } from "../config/image.config";
import { POST_VIDEO_MAX_BYTES } from "../constants/postMedia.constants";
import {
  assertVideoAllowed,
  extractVideoFrameJpeg,
  hasFfmpeg,
  isVideoOptimizeEnabled,
  optimizeVideoBuffer,
  probeVideoFile
} from "../utils/videoProcessor";
import fs from "fs";
import path from "path";
import { R2_CACHE_CONTROL_IMMUTABLE } from "../config/r2Cache.config";
import {
  getCompletedMediaResult,
  toDeliveryVariants,
  type FinalizeMediaResult,
  type MediaVariantsDto
} from "../utils/mediaProcessingResult";
import {
  createMediaTempDirectory,
  removeMediaTempDirectory
} from "../utils/mediaTempFiles";

const VIDEO_DOWNLOAD_MAX = Math.max(POST_VIDEO_MAX_BYTES + 1024 * 1024, 55 * 1024 * 1024);

export type MediaCompletionAttributes = {
  fileUrl: string;
  objectKey: string;
  variantsJson: string;
  processingStatus: "completed";
  byteSize: number;
  width: number | null;
  height: number | null;
};

export type ProcessedMedia = {
  result: FinalizeMediaResult;
  mediaUpdates: MediaCompletionAttributes;
  /** Deleted by MediaJob only after successful DB commit + ownership check. */
  keysToDeleteAfterCommit: string[];
};

function isMissingObjectError(error: unknown): boolean {
  const e = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  const status = Number(e?.$metadata?.httpStatusCode ?? 0);
  return (
    status === 404 ||
    e?.name === "NotFound" ||
    e?.name === "NoSuchKey" ||
    e?.Code === "NoSuchKey" ||
    /not found|NoSuchKey/i.test(error instanceof Error ? error.message : String(error))
  );
}

function completedMedia(row: MediaFile, result: FinalizeMediaResult): ProcessedMedia {
  return {
    result,
    mediaUpdates: {
      fileUrl: row.fileUrl,
      objectKey: row.objectKey ?? row.fileUrl,
      variantsJson: row.variantsJson ?? JSON.stringify(result.variants),
      processingStatus: "completed",
      byteSize: row.byteSize ?? result.byteSize,
      width: row.width,
      height: row.height
    },
    keysToDeleteAfterCommit: []
  };
}

async function finalizeImage(row: MediaFile): Promise<ProcessedMedia> {
  const isPrivate = isPrivateR2Object(row.objectKey ?? row.fileUrl);
  const completed = getCompletedMediaResult(row);
  if (completed) return completedMedia(row, completed);

  const stagingKey = row.objectKey ?? extractR2KeyFromUrl(row.fileUrl);
  if (!stagingKey) {
    throw Object.assign(new Error("Invalid media storage key"), { status: 400 });
  }

  const { thumbKey, mediumKey, fullKey } = imageVariantKeys(stagingKey);

  let raw: Buffer | null = null;
  try {
    raw = await getR2ObjectBuffer(stagingKey, IMAGE_PROCESS_DOWNLOAD_MAX_BYTES);
  } catch (error) {
    if (!isMissingObjectError(error)) throw error;
    // Retry-safe: a prior attempt may have written variants and deleted staging.
    const meta = await getR2ObjectMetadata(fullKey).catch(() => null);
    if (!meta || meta.byteSize <= 0) throw error;
    const variantKeys: MediaVariantsDto = { thumb: thumbKey, medium: mediumKey, full: fullKey };
    const variants = toDeliveryVariants(variantKeys, isPrivate);
    return {
      result: {
        mediaFileId: row.id,
        publicUrl: variants.full,
        variants,
        width: row.width ?? 0,
        height: row.height ?? 0,
        byteSize: meta.byteSize,
        mediaType: "image"
      },
      mediaUpdates: {
        fileUrl: fullKey,
        objectKey: fullKey,
        variantsJson: JSON.stringify(variantKeys),
        processingStatus: "completed",
        byteSize: meta.byteSize,
        width: row.width,
        height: row.height
      },
      keysToDeleteAfterCommit: []
    };
  }

  const sniffed = sniffImageMime(raw);
  if (!sniffed) {
    throw Object.assign(new Error("Unsupported or invalid image file"), { status: 400 });
  }

  const processed = await processImageBuffer(raw);

  await Promise.all([
    putR2ObjectBuffer(thumbKey, processed.thumb.buffer, IMAGE_OUTPUT_MIME, {
      cacheControl: R2_CACHE_CONTROL_IMMUTABLE
    }),
    putR2ObjectBuffer(mediumKey, processed.medium.buffer, IMAGE_OUTPUT_MIME, {
      cacheControl: R2_CACHE_CONTROL_IMMUTABLE
    }),
    putR2ObjectBuffer(fullKey, processed.full.buffer, IMAGE_OUTPUT_MIME, {
      cacheControl: R2_CACHE_CONTROL_IMMUTABLE
    })
  ]);

  const variantKeys: MediaVariantsDto = { thumb: thumbKey, medium: mediumKey, full: fullKey };
  const variants = toDeliveryVariants(variantKeys, isPrivate);
  const keysToDeleteAfterCommit =
    stagingKey !== fullKey && stagingKey !== mediumKey && stagingKey !== thumbKey
      ? [stagingKey]
      : [];

  return {
    result: {
      mediaFileId: row.id,
      publicUrl: variants.full,
      variants,
      width: processed.full.width,
      height: processed.full.height,
      byteSize: processed.full.bytes,
      mediaType: "image"
    },
    mediaUpdates: {
      fileUrl: fullKey,
      objectKey: fullKey,
      variantsJson: JSON.stringify(variantKeys),
      processingStatus: "completed",
      byteSize: processed.full.bytes,
      width: processed.full.width,
      height: processed.full.height
    },
    keysToDeleteAfterCommit
  };
}

async function finalizeVideo(row: MediaFile): Promise<ProcessedMedia> {
  const isPrivate = isPrivateR2Object(row.objectKey ?? row.fileUrl);
  const completed = getCompletedMediaResult(row);
  if (completed) return completedMedia(row, completed);

  const stagingKey = row.objectKey ?? extractR2KeyFromUrl(row.fileUrl);
  if (!stagingKey) {
    throw Object.assign(new Error("Invalid media storage key"), { status: 400 });
  }

  const optKey = videoOptimizedKey(stagingKey);
  let raw: Buffer | null = null;
  try {
    raw = await getR2ObjectBuffer(stagingKey, VIDEO_DOWNLOAD_MAX);
  } catch (error) {
    if (!isMissingObjectError(error)) throw error;
    // Retry-safe: staging may already be gone after a prior successful optimize+commit.
    const optMeta = await getR2ObjectMetadata(optKey).catch(() => null);
    if (!optMeta || optMeta.byteSize <= 0) throw error;
    const posters = videoPosterKeys(stagingKey);
    const variantKeys: MediaVariantsDto = {
      thumb: posters.thumbKey,
      medium: posters.mediumKey,
      full: posters.fullKey
    };
    const variants = toDeliveryVariants(variantKeys, isPrivate);
    const publicUrl = isPrivate ? optKey : getCdnPublicUrl(optKey);
    const variantsJson = JSON.stringify({
      ...variantKeys,
      video: optKey,
      durationSec: null
    });
    return {
      result: {
        mediaFileId: row.id,
        publicUrl,
        variants,
        width: row.width ?? 0,
        height: row.height ?? 0,
        byteSize: optMeta.byteSize,
        thumbnailUrl: isPrivate ? posters.mediumKey : getCdnPublicUrl(posters.mediumKey),
        durationSec: null,
        mediaType: "video"
      },
      mediaUpdates: {
        fileUrl: optKey,
        objectKey: optKey,
        variantsJson,
        processingStatus: "completed",
        byteSize: optMeta.byteSize,
        width: row.width,
        height: row.height
      },
      keysToDeleteAfterCommit: []
    };
  }

  const optimizeOn = isVideoOptimizeEnabled() && (await hasFfmpeg());
  const ffmpegAvailable = await hasFfmpeg();

  let videoBuf = raw;
  let width = 0;
  let height = 0;
  let durationSec = 0;
  let outKey = stagingKey;
  let optimizedWritten = false;

  if (optimizeOn) {
    try {
      const optimized = await optimizeVideoBuffer(raw, `media-${row.id}`);
      videoBuf = optimized.buffer;
      width = optimized.width;
      height = optimized.height;
      durationSec = optimized.durationSec;
      outKey = optKey;
      await putR2ObjectBuffer(outKey, videoBuf, "video/mp4", {
        cacheControl: R2_CACHE_CONTROL_IMMUTABLE
      });
      optimizedWritten = true;
    } catch (e: unknown) {
      // Optimize failed — only keep original if it is already H.264/AAC/MP4-safe.
      console.warn(
        "[media] video optimize failed:",
        e instanceof Error ? e.message : e
      );
      const tmp = await createMediaTempDirectory("dh-probe-");
      const p = path.join(tmp, "v.bin");
      try {
        await fs.promises.writeFile(p, raw);
        const probe = await probeVideoFile(p);
        assertVideoAllowed(probe, raw.length, { requireCompliantCodecs: true });
        width = probe.width;
        height = probe.height;
        durationSec = probe.durationSec;
      } finally {
        await removeMediaTempDirectory(tmp);
      }
      await putR2ObjectBuffer(stagingKey, raw, "video/mp4", {
        cacheControl: R2_CACHE_CONTROL_IMMUTABLE
      });
      outKey = stagingKey;
      videoBuf = raw;
    }
  } else {
    // No server transcode: require H.264/AAC when ffprobe is available.
    if (ffmpegAvailable) {
      const tmp = await createMediaTempDirectory("dh-probe-");
      const p = path.join(tmp, "v.bin");
      try {
        await fs.promises.writeFile(p, raw);
        const probe = await probeVideoFile(p);
        assertVideoAllowed(probe, raw.length, { requireCompliantCodecs: true });
        width = probe.width;
        height = probe.height;
        durationSec = probe.durationSec;
      } finally {
        await removeMediaTempDirectory(tmp);
      }
    } else if (isVideoOptimizeEnabled()) {
      console.warn(
        "[media] VIDEO_OPTIMIZE_ENABLED but ffmpeg/ffprobe missing — install ffmpeg for 720p H.264 finalize"
      );
    }
    await putR2ObjectBuffer(stagingKey, raw, "video/mp4", {
      cacheControl: R2_CACHE_CONTROL_IMMUTABLE
    });
  }

  let variantKeys: MediaVariantsDto = { thumb: outKey, medium: outKey, full: outKey };
  let posterMediumKey: string | null = null;
  let postersWritten = false;

  if (ffmpegAvailable) {
    try {
      const at = Math.max(0.2, Math.min((durationSec || 3) * 0.35, (durationSec || 3) - 0.1));
      const frame = await extractVideoFrameJpeg(videoBuf, at, `thumb-${row.id}`);
      const processed = await processImageBuffer(frame);
      const keys = videoPosterKeys(stagingKey);
      await Promise.all([
        putR2ObjectBuffer(keys.thumbKey, processed.thumb.buffer, IMAGE_OUTPUT_MIME, {
          cacheControl: R2_CACHE_CONTROL_IMMUTABLE
        }),
        putR2ObjectBuffer(keys.mediumKey, processed.medium.buffer, IMAGE_OUTPUT_MIME, {
          cacheControl: R2_CACHE_CONTROL_IMMUTABLE
        }),
        putR2ObjectBuffer(keys.fullKey, processed.full.buffer, IMAGE_OUTPUT_MIME, {
          cacheControl: R2_CACHE_CONTROL_IMMUTABLE
        })
      ]);
      variantKeys = {
        thumb: keys.thumbKey,
        medium: keys.mediumKey,
        full: keys.fullKey
      };
      posterMediumKey = keys.mediumKey;
      postersWritten = true;
    } catch (e) {
      console.warn("[media] video poster failed:", e instanceof Error ? e.message : e);
    }
  }

  const variants = toDeliveryVariants(variantKeys, isPrivate);
  const thumbnailUrl = posterMediumKey
    ? isPrivate
      ? posterMediumKey
      : getCdnPublicUrl(posterMediumKey)
    : null;
  const publicUrl = isPrivate ? outKey : getCdnPublicUrl(outKey);
  const variantsJson = JSON.stringify({
    ...variantKeys,
    video: outKey,
    durationSec: durationSec || null
  });

  // Delete staging only when optimize produced a distinct object AND posters exist
  // (or ffmpeg is unavailable so posters were never expected).
  const keysToDeleteAfterCommit: string[] = [];
  if (
    optimizedWritten &&
    outKey !== stagingKey &&
    (!ffmpegAvailable || postersWritten)
  ) {
    keysToDeleteAfterCommit.push(stagingKey);
  }

  return {
    result: {
      mediaFileId: row.id,
      publicUrl,
      variants,
      width,
      height,
      byteSize: videoBuf.length,
      thumbnailUrl,
      durationSec: durationSec || null,
      mediaType: "video"
    },
    mediaUpdates: {
      fileUrl: outKey,
      objectKey: outKey,
      variantsJson,
      processingStatus: "completed",
      byteSize: videoBuf.length,
      width: width || null,
      height: height || null
    },
    keysToDeleteAfterCommit
  };
}

/**
 * Process an uploaded image or video in the standalone worker.
 */
export async function processMediaFile(mediaFileId: number): Promise<ProcessedMedia> {
  const row = await MediaFile.findByPk(mediaFileId);
  if (!row) {
    throw Object.assign(new Error("Media not found"), { status: 404 });
  }
  if (row.fileType === "image") return finalizeImage(row);
  if (row.fileType === "video") return finalizeVideo(row);
  throw Object.assign(new Error("Unsupported media type for processing"), { status: 400 });
}

export const mediaProcessingService = {
  processMediaFile
};
