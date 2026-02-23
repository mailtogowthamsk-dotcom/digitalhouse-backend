import { Otp, User } from "../models";
import { generateOtp } from "../utils/generateOtp";
import { hashEmailOtp } from "../utils/hash.util";
import { sendOtpEmail } from "./mail.service";

const OTP_EXPIRES_MIN = Number(process.env.OTP_EXPIRES_MINUTES || 5);
const RESEND_COOLDOWN_SEC = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 60);

/**
 * Create OTP for an approved user, save hashed, send email.
 * Rate limit: do not send if last OTP was sent within cooldown.
 */
export async function createAndSendOtp(user: User): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const email = user.email.toLowerCase().trim();
  const now = new Date();

  const lastOtp = await Otp.findOne({
    where: { userId: user.id },
    order: [["id", "DESC"]]
  });

  if (lastOtp) {
    const sentAt = new Date(lastOtp.createdAt).getTime();
    if ((now.getTime() - sentAt) / 1000 < RESEND_COOLDOWN_SEC) {
      return { ok: true, message: "OTP recently sent. Please wait before requesting again." };
    }
  }

  const code = generateOtp();
  const otpHash = hashEmailOtp(email, code);
  const expiresAt = new Date(now.getTime() + OTP_EXPIRES_MIN * 60 * 1000);

  await Otp.create({
    userId: user.id,
    otpHash,
    expiresAt,
    isUsed: false,
    createdAt: now
  } as any);

  // Temporary: log OTP to server console when email is broken (set LOG_OTP_FOR_DEV=true)
  if (process.env.LOG_OTP_FOR_DEV === "true") {
    console.log("[OTP] DEV — use this code for", email, "→", code);
  }

  // Await email so we can tell the client if sending failed (e.g. production SMTP misconfigured).
  // Timeout in mail.service (25s) prevents long hangs.
  try {
    await sendOtpEmail(email, code, OTP_EXPIRES_MIN);
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error("[OTP] Failed to send email to", email, msg);
    if (msg.includes("timeout")) {
      console.error("[OTP] Check SMTP: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM. Use a cloud SMTP (Resend/SendGrid/Mailgun) if provider times out.");
    }
    return {
      ok: false,
      message: "Could not send verification email. Please try again or contact support."
    };
  }

  return { ok: true, message: "OTP sent to your email." };
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
  if (record.isUsed) return { valid: false, message: "OTP already used. Please request a new OTP." };
  if (new Date(record.expiresAt).getTime() < now.getTime()) return { valid: false, message: "OTP expired." };

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
