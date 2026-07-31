import crypto from "crypto";

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Hash OTP with server-side pepper and email context binding.
 * Production: OTP_HASH_PEPPER is required (validated at startup) — no fallback.
 * Development: falls back to "dev-pepper" with warning at validate time.
 */
export function hashEmailOtp(email: string, otp: string): string {
  const pepper =
    process.env.NODE_ENV === "production"
      ? String(process.env.OTP_HASH_PEPPER || "").trim()
      : String(process.env.OTP_HASH_PEPPER || "dev-pepper").trim();
  if (!pepper) {
    throw new Error("OTP_HASH_PEPPER is not configured");
  }
  return sha256Hex(`${pepper}:${email.toLowerCase().trim()}:${otp}`);
}
