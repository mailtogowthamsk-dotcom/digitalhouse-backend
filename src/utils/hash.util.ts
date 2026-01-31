import crypto from "crypto";

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Hash OTP with server-side pepper and email context binding.
 * This prevents validating OTPs if DB leaks.
 */
export function hashEmailOtp(email: string, otp: string): string {
  const pepper = process.env.OTP_HASH_PEPPER || "dev-pepper";
  return sha256Hex(`${pepper}:${email.toLowerCase().trim()}:${otp}`);
}

