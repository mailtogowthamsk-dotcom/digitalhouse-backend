import sharp from "sharp";

const MAX_PIXELS = 40_000_000;
const MAX_EDGE = 4096;
const MODEL_EDGE = 224;

export type SafeImageTensor = {
  tensor: { data: Float32Array; width: number; height: number };
  width: number;
  height: number;
};

/**
 * Hostile-input decode: magic/size/dimensions enforced by sharp failOn + pixel cap.
 * Does not trust filename, extension, or client MIME.
 */
export async function decodeImageForModeration(
  buffer: Buffer,
  maxBytes: number
): Promise<{ rgb: Buffer; width: number; height: number }> {
  if (!buffer?.length) {
    throw Object.assign(new Error("Empty image"), { code: "CORRUPT_IMAGE" });
  }
  if (buffer.length > maxBytes) {
    throw Object.assign(new Error("Image exceeds moderation size limit"), { code: "IMAGE_TOO_LARGE" });
  }
  let meta;
  try {
    meta = await sharp(buffer, { failOn: "truncated", limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    throw Object.assign(new Error("Unable to decode image"), { code: "CORRUPT_IMAGE" });
  }
  if (!meta.format || !["jpeg", "jpg", "png", "webp", "gif"].includes(meta.format)) {
    throw Object.assign(new Error("Unsupported image format"), { code: "UNSUPPORTED_IMAGE" });
  }
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w < 8 || h < 8) {
    throw Object.assign(new Error("Image too small to classify"), { code: "CORRUPT_IMAGE" });
  }
  if (w > MAX_EDGE || h > MAX_EDGE) {
    throw Object.assign(new Error("Image dimensions exceed limit"), { code: "IMAGE_TOO_LARGE" });
  }

  const { data, info } = await sharp(buffer, { failOn: "truncated", limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize(MODEL_EDGE, MODEL_EDGE, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 3) {
    throw Object.assign(new Error("Unexpected image channel count"), { code: "CORRUPT_IMAGE" });
  }
  return { rgb: data, width: info.width, height: info.height };
}

export function rgbToFloat32(rgb: Buffer): Float32Array {
  const out = new Float32Array(rgb.length);
  for (let i = 0; i < rgb.length; i += 1) out[i] = rgb[i] / 255;
  return out;
}
