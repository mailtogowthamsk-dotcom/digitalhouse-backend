/**
 * Post-upload media processing: images → WebP variants; videos → H.264/AAC faststart + posters.
 * Existing ready media is returned as-is (idempotent / backward compatible).
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
import os from "os";
import path from "path";
import { R2_CACHE_CONTROL_IMMUTABLE } from "../config/r2Cache.config";

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
  /** Present for video finalize */
  thumbnailUrl?: string | null;
  durationSec?: number | null;
  mediaType?: "image" | "video";
};

const processingLocks = new Set<number>();

const VIDEO_DOWNLOAD_MAX = Math.max(POST_VIDEO_MAX_BYTES + 1024 * 1024, 55 * 1024 * 1024);

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

async function finalizeImage(row: MediaFile, userId: number): Promise<FinalizeMediaResult> {
  if (row.processingStatus === "ready" && row.variantsJson) {
    const variants = JSON.parse(row.variantsJson) as MediaVariantsDto;
    return {
      mediaFileId: row.id,
      publicUrl: row.fileUrl,
      variants,
      width: row.width ?? 0,
      height: row.height ?? 0,
      byteSize: row.byteSize ?? 0,
      mediaType: "image"
    };
  }

  await row.update({ processingStatus: "processing" });

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
    byteSize: processed.full.bytes,
    mediaType: "image"
  };
}

async function finalizeVideo(row: MediaFile, userId: number): Promise<FinalizeMediaResult> {
  if (row.processingStatus === "ready" && row.variantsJson) {
    const variants = JSON.parse(row.variantsJson) as MediaVariantsDto & { video?: string };
    return {
      mediaFileId: row.id,
      publicUrl: row.fileUrl,
      variants: {
        thumb: variants.thumb,
        medium: variants.medium,
        full: variants.full
      },
      width: row.width ?? 0,
      height: row.height ?? 0,
      byteSize: row.byteSize ?? 0,
      thumbnailUrl: variants.medium || variants.thumb || null,
      mediaType: "video"
    };
  }

  await row.update({ processingStatus: "processing" });

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
      if (outKey !== stagingKey) {
        await deleteR2ObjectByKey(stagingKey);
      }
    } catch (e: any) {
      // Optimize failed — only keep original if it is already H.264/AAC/MP4-safe.
      console.warn("[media] video optimize failed:", e?.message || e);
      const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dh-probe-"));
      const p = path.join(tmp, "v.bin");
      try {
        await fs.promises.writeFile(p, raw);
        const probe = await probeVideoFile(p);
        assertVideoAllowed(probe, raw.length, { requireCompliantCodecs: true });
        width = probe.width;
        height = probe.height;
        durationSec = probe.durationSec;
      } finally {
        await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
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
      const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dh-probe-"));
      const p = path.join(tmp, "v.bin");
      try {
        await fs.promises.writeFile(p, raw);
        const probe = await probeVideoFile(p);
        assertVideoAllowed(probe, raw.length, { requireCompliantCodecs: true });
        width = probe.width;
        height = probe.height;
        durationSec = probe.durationSec;
      } finally {
        await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
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

  let variants: MediaVariantsDto = {
    thumb: getCdnPublicUrl(outKey),
    medium: getCdnPublicUrl(outKey),
    full: getCdnPublicUrl(outKey)
  };
  let thumbnailUrl: string | null = null;

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
      variants = {
        thumb: getCdnPublicUrl(keys.thumbKey),
        medium: getCdnPublicUrl(keys.mediumKey),
        full: getCdnPublicUrl(keys.fullKey)
      };
      thumbnailUrl = variants.medium;
    } catch (e) {
      console.warn("[media] video poster failed:", e instanceof Error ? e.message : e);
    }
  }

  const publicUrl = getCdnPublicUrl(outKey);
  await row.update({
    fileUrl: publicUrl,
    objectKey: outKey,
    variantsJson: JSON.stringify({ ...variants, video: publicUrl }),
    processingStatus: "ready",
    byteSize: videoBuf.length,
    width: width || null,
    height: height || null
  });

  return {
    mediaFileId: row.id,
    publicUrl,
    variants,
    width,
    height,
    byteSize: videoBuf.length,
    thumbnailUrl,
    durationSec: durationSec || null,
    mediaType: "video"
  };
}

/**
 * Process an uploaded image or video after client PUT to R2.
 */
export async function finalizeMediaFile(
  mediaFileId: number,
  userId: number
): Promise<FinalizeMediaResult> {
  if (processingLocks.has(mediaFileId)) {
    throw Object.assign(new Error("Processing already in progress"), { status: 409 });
  }
  processingLocks.add(mediaFileId);

  try {
    const row = await MediaFile.findByPk(mediaFileId);
    if (!row) {
      throw Object.assign(new Error("Media not found"), { status: 404 });
    }
    if (row.userId !== userId) {
      throw Object.assign(new Error("Forbidden"), { status: 403 });
    }
    if (row.fileType === "image") {
      return await finalizeImage(row, userId);
    }
    if (row.fileType === "video") {
      return await finalizeVideo(row, userId);
    }
    throw Object.assign(new Error("Unsupported media type for finalize"), { status: 400 });
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
