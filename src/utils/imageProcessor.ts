/**
 * Server-side image optimization with sharp.
 * Strips EXIF, preserves aspect ratio, outputs WebP variants.
 */

import sharp from "sharp";
import {
  IMAGE_MAX_DIMENSION,
  IMAGE_TARGET_BYTES,
  IMAGE_MEDIUM_MAX,
  IMAGE_THUMB_MAX,
  IMAGE_WEBP_QUALITY,
  IMAGE_WEBP_QUALITY_MIN,
  IMAGE_OUTPUT_MIME
} from "../config/image.config";

export type ProcessedImageVariant = {
  buffer: Buffer;
  width: number;
  height: number;
  bytes: number;
};

export type ProcessedImageSet = {
  full: ProcessedImageVariant;
  medium: ProcessedImageVariant;
  thumb: ProcessedImageVariant;
  sourceWidth: number;
  sourceHeight: number;
};

const MAX_PIXELS = 40_000_000; // ~8k × 5k guard against decompression bombs

async function encodeWebp(
  pipeline: sharp.Sharp,
  longEdge: number,
  targetBytes?: number
): Promise<ProcessedImageVariant> {
  let quality = IMAGE_WEBP_QUALITY;
  let last: ProcessedImageVariant | null = null;

  for (let attempt = 0; attempt < 8; attempt++) {
    const out = await pipeline
      .clone()
      .rotate()
      .resize(longEdge, longEdge, { fit: "inside", withoutEnlargement: true })
      .webp({ quality, effort: 4, smartSubsample: true })
      .toBuffer({ resolveWithObject: true });

    const variant: ProcessedImageVariant = {
      buffer: out.data,
      width: out.info.width,
      height: out.info.height,
      bytes: out.data.length
    };
    last = variant;

    if (!targetBytes || variant.bytes <= targetBytes || quality <= IMAGE_WEBP_QUALITY_MIN) {
      return variant;
    }
    quality = Math.max(IMAGE_WEBP_QUALITY_MIN, quality - 8);
  }

  return last!;
}

/**
 * Validate buffer is a safe image and produce thumb / medium / full WebP buffers.
 */
export async function processImageBuffer(input: Buffer): Promise<ProcessedImageSet> {
  const meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
  if (!meta.width || !meta.height) {
    throw new Error("Invalid image: missing dimensions");
  }

  const base = sharp(input, { limitInputPixels: MAX_PIXELS }).rotate();

  const [thumb, medium, full] = await Promise.all([
    encodeWebp(base, IMAGE_THUMB_MAX),
    encodeWebp(base, IMAGE_MEDIUM_MAX),
    encodeWebp(base, IMAGE_MAX_DIMENSION, IMAGE_TARGET_BYTES)
  ]);

  return {
    thumb,
    medium,
    full,
    sourceWidth: meta.width,
    sourceHeight: meta.height
  };
}

/** Magic-byte MIME sniff for allowed raster types. */
export function sniffImageMime(buffer: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function variantKeysFromUploadKey(uploadKey: string): {
  thumbKey: string;
  mediumKey: string;
  fullKey: string;
} {
  const dot = uploadKey.lastIndexOf(".");
  const base = dot > 0 ? uploadKey.slice(0, dot) : uploadKey;
  return {
    thumbKey: `${base}_thumb.webp`,
    mediumKey: `${base}_md.webp`,
    fullKey: `${base}_full.webp`
  };
}

export { IMAGE_OUTPUT_MIME };
