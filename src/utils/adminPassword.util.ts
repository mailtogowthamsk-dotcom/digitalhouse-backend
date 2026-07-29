/**
 * Password hashing for admin accounts (Node crypto scrypt — no extra dependency).
 * Format: saltHex:hashHex
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "crypto";
import { promisify } from "util";

/** promisify() resolves to the 3-arg overload, so keep the options overload explicit. */
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
  options?: ScryptOptions
) => Promise<Buffer>;

/** scrypt params — modest cost suitable for admin login (not mobile OTP). */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  });
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = String(stored || "").split(":");
  if (!salt || !hashHex) return false;
  try {
    const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P
    });
    const expected = Buffer.from(hashHex, "hex");
    if (expected.length !== derived.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    // Legacy hashes (Phase 5 default scrypt options) still verify
    try {
      const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN);
      const expected = Buffer.from(hashHex, "hex");
      if (expected.length !== derived.length) return false;
      return timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }
}

/** Constant-time string compare for shared-password / API-key style secrets. */
export function safeEqualString(a: string, b: string): boolean {
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

/** Burn similar CPU when no password hash exists (reduces timing oracle on unknown emails). */
export async function dummyPasswordVerify(password: string): Promise<void> {
  const dummy = `00000000000000000000000000000000:${"00".repeat(64)}`;
  await verifyPassword(password || "x", dummy);
}
