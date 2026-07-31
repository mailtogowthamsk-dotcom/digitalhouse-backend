import { timingSafeEqual } from "crypto";

/** Constant-time compare for equal-length hex digests (HMAC, OTP hashes). */
export function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(String(a), "hex");
    const bufB = Buffer.from(String(b), "hex");
    if (bufA.length === 0 || bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/** Constant-time compare for utf8 strings of any length (pads to common length). */
export function timingSafeEqualUtf8(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a), "utf8");
  const bufB = Buffer.from(String(b), "utf8");
  if (bufA.length !== bufB.length) {
    const len = Math.max(bufA.length, bufB.length, 1);
    const left = Buffer.alloc(len);
    const right = Buffer.alloc(len);
    bufA.copy(left);
    bufB.copy(right);
    timingSafeEqual(left, right);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
