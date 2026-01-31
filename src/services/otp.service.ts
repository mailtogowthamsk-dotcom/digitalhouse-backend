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

  await sendOtpEmail(email, code, OTP_EXPIRES_MIN);

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
