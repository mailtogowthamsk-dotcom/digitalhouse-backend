import sharp from "sharp";
import {
  PERCEPTUAL_HASH_ALGORITHM,
  PERCEPTUAL_HASH_MAX_DISTANCE
} from "../../constants/contentSafety.constants";

/**
 * 16-hex dHash via sharp. Detects common resize/recompress/metadata changes.
 * Does not claim perfect transformed-media detection. Video fingerprinting is
 * an extension point (see CONTENT_SAFETY.md).
 */
export async function computeImageDHash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer, { failOn: "truncated", limitInputPixels: 40_000_000 })
    .rotate()
    .resize(9, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bits = "";
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = data[y * 9 + x] ?? 0;
      const right = data[y * 9 + x + 1] ?? 0;
      bits += left > right ? "1" : "0";
    }
  }
  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let dist = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = parseInt(a[i] ?? "0", 16) ^ parseInt(b[i] ?? "0", 16);
    dist += x.toString(2).replace(/0/g, "").length;
  }
  return dist;
}

export function isKnownBadHashMatch(candidate: string, stored: string, maxDistance = PERCEPTUAL_HASH_MAX_DISTANCE): boolean {
  return hammingHex(candidate, stored) <= maxDistance;
}

export const fingerprintAlgorithm = PERCEPTUAL_HASH_ALGORITHM;
