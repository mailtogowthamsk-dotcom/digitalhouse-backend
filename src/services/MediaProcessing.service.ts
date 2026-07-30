/**
 * Post-upload media processing: images → WebP variants; videos → H.264/AAC faststart + posters.
 * Runs only in the standalone media worker. Existing completed media is
 * returned as-is (idempotent / backward compatible).
 */

import { MediaFile } from "../models";
import {
  extractR2KeyFromUrl,
  getR2ObjectBuffer,
  putR2ObjectBuffer,
  getCdnPublicUrl,
  isPrivateR2Object
} from "../utils/r2Client";
import {
  processImageBuffer,
  sniffImageMime,
  variantKeysFromUploadKey,
  IMAGE_OUTPUT_MIME
} from "../utils/imageProcessor";
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
};

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
    }
  };
}

function videoOptimizedKey(stagingKey: string): string {
  const dir = path.posix.dirname(stagingKey);
  const base = path.posix.basename(stagingKey).replace(/\.[^.]+$/, "");
  return `${dir}/${base}_opt.mp4`;
}

function videoPosterKeys(stagingKey: string): { thumbKey: string; mediumKey: string; fullKey: string } {
  const base = path.posix.basename(stagingKey).replace(/\.[^.]+$/, "");
  const m = stagingKey.match(/^(.*\/videos\/)posts\/(\d{4}\/\d{2}\/)(.+)$/);
  const root = m ? `${m[1]}thumbnails/${m[2]}` : `${path.posix.dirname(stagingKey)}/`;
  return {
    thumbKey: `${root}${base}_poster_thumb.webp`,
    mediumKey: `${root}${base}_poster_md.webp`,
    fullKey: `${root}${base}_poster_full.webp`
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

  const raw = await getR2ObjectBuffer(stagingKey, IMAGE_PROCESS_DOWNLOAD_MAX_BYTES);
  const sniffed = sniffImageMime(raw);
  if (!sniffed) {
    throw Object.assign(new Error("Unsupported or invalid image file"), { status: 400 });
  }

  const processed = await processImageBuffer(raw);
  const { thumbKey, mediumKey, fullKey } = variantKeysFromUploadKey(stagingKey);

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
    }
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

  const raw = await getR2ObjectBuffer(stagingKey, VIDEO_DOWNLOAD_MAX);
  const optimizeOn = isVideoOptimizeEnabled() && (await hasFfmpeg());

  let videoBuf = raw;
  let width = 0;
  let height = 0;
  let durationSec = 0;
  let outKey = stagingKey;

  if (optimizeOn) {
    try {
      const optimized = await optimizeVideoBuffer(raw, `media-${row.id}`);
      videoBuf = optimized.buffer;
      width = optimized.width;
      height = optimized.height;
      durationSec = optimized.durationSec;
      outKey = videoOptimizedKey(stagingKey);
      await putR2ObjectBuffer(outKey, videoBuf, "video/mp4", {
        cacheControl: R2_CACHE_CONTROL_IMMUTABLE
      });
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
    if (await hasFfmpeg()) {
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

  if (await hasFfmpeg()) {
    try {
      const at = Math.max(0.2, Math.min((durationSec || 3) * 0.35, (durationSec || 3) - 0.1));
      const frame = await extractVideoFrameJpeg(videoBuf, at, `thumb-${row.id}`);
      const processed = await processImageBuffer(frame);
      const keys = videoPosterKeys(stagingKey);
      await Promise.all([
        putR2ObjectBuffer(keys.thumbKey, processed.thumb.buffer, IMAGE_OUTPUT_MIME),
        putR2ObjectBuffer(keys.mediumKey, processed.medium.buffer, IMAGE_OUTPUT_MIME),
        putR2ObjectBuffer(keys.fullKey, processed.full.buffer, IMAGE_OUTPUT_MIME)
      ]);
      variantKeys = {
        thumb: keys.thumbKey,
        medium: keys.mediumKey,
        full: keys.fullKey
      };
      posterMediumKey = keys.mediumKey;
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
    }
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
