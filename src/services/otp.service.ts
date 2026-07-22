import { Otp, User } from "../models";
import { generateOtp } from "../utils/generateOtp";
import { hashEmailOtp } from "../utils/hash.util";
import { sendOtpEmail } from "./mail.service";

const OTP_EXPIRES_MIN = Number(process.env.OTP_EXPIRES_MINUTES || 5);
const RESEND_COOLDOWN_SEC = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 60);

export type CreateOtpResult =
  | { ok: true; sent: true; message: string }
  | { ok: true; sent: false; message: string; retryAfterSec: number }
  | { ok: false; message: string };

/**
 * Create OTP for an approved user, save hashed, send email.
 * Rate limit: do not re-send while an unused OTP is still within cooldown.
 * If the latest OTP was already used (e.g. verify succeeded but client failed),
 * always allow a fresh code — otherwise the user is stuck until cooldown ends.
 */
export async function createAndSendOtp(user: User): Promise<CreateOtpResult> {
  const email = user.email.toLowerCase().trim();
  const now = new Date();

  const lastOtp = await Otp.findOne({
    where: { userId: user.id },
    order: [["id", "DESC"]]
  });

  if (lastOtp && !lastOtp.isUsed) {
    const sentAt = new Date(lastOtp.createdAt).getTime();
    const ageSec = (now.getTime() - sentAt) / 1000;
    if (ageSec < RESEND_COOLDOWN_SEC) {
      const retryAfterSec = Math.max(1, Math.ceil(RESEND_COOLDOWN_SEC - ageSec));
      return {
        ok: true,
        sent: false,
        retryAfterSec,
        message: `A code was already sent. Check your email, or wait ${retryAfterSec}s to request a new one.`
      };
    }
  }

  const code = generateOtp();
  const otpHash = hashEmailOtp(email, code);
  const expiresAt = new Date(now.getTime() + OTP_EXPIRES_MIN * 60 * 1000);

  // Dev-only: never log OTPs in production
  const logOtpDev =
    process.env.LOG_OTP_FOR_DEV === "true" && process.env.NODE_ENV !== "production";
  if (logOtpDev) {
    console.log("[OTP] DEV — use this code for", email, "→", code);
  }

  // Send first so a failed SMTP attempt does not leave an unused OTP that blocks resend
  // (cooldown would tell the client "already sent" even though nothing arrived).
  try {
    await sendOtpEmail(email, code, OTP_EXPIRES_MIN);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[OTP] Failed to send email to", email, msg);
    if (
      msg.includes("timeout") ||
      msg.includes("SMTP") ||
      msg.includes("ECONNREFUSED") ||
      msg.includes("EAUTH")
    ) {
      console.error(
        "[OTP] Check SMTP: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM / MAIL_FROM, SMTP_ENCRYPTION (tls|ssl|none)."
      );
    }
    // Still persist when logging OTP in dev so verify works without inbox delivery.
    if (!logOtpDev) {
      return {
        ok: false,
        message: "Could not send verification email. Please try again or contact support."
      };
    }
    console.warn("[OTP] Persisting OTP anyway because LOG_OTP_FOR_DEV=true (email failed).");
  }

  // Invalidate any prior unused codes so verify always uses the latest.
  await Otp.update({ isUsed: true }, { where: { userId: user.id, isUsed: false } });

  await Otp.create({
    userId: user.id,
    otpHash,
    expiresAt,
    isUsed: false,
    createdAt: now
  } as any);

  console.log("[OTP] Sent verification code to", email);
  return { ok: true, sent: true, message: "OTP sent to your email." };
}

/**
 * Verify OTP for user: must match latest unused, non-expired OTP.
 * On success mark as used and return user.
 */
export async function verifyOtpForUser(
  userId: number,
  email: string,
  otp: string
): Promise<{ valid: true; user: User } | { valid: false; message: string }> {
  const now = new Date();

  const record = await Otp.findOne({
    where: { userId },
    order: [["id", "DESC"]]
  });

  if (!record) return { valid: false, message: "OTP not found. Please request a new OTP." };
  if (record.isUsed) {
    return {
      valid: false,
      message: "This code was already used. Go back and request a new OTP."
    };
  }
  if (new Date(record.expiresAt).getTime() < now.getTime()) {
    return { valid: false, message: "OTP expired. Go back and request a new OTP." };
  }

  const expectedHash = hashEmailOtp(email.toLowerCase().trim(), otp);
  if (expectedHash !== record.otpHash) return { valid: false, message: "Invalid OTP." };

  await record.update({ isUsed: true });

  const user = await User.findByPk(userId);
  if (!user) return { valid: false, message: "User not found." };

  return { valid: true, user };
}

export const otpService = {
  createAndSendOtp,
  verifyOtpForUser
};
