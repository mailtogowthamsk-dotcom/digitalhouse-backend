import { mailer } from "../config/mail";

/** Send OTP email to user (community-friendly copy) */
export async function sendOtpEmail(to: string, otp: string, expiresMinutes: number): Promise<void> {
  await mailer.sendMail({
    from: process.env.MAIL_FROM,
    to: to.toLowerCase().trim(),
    subject: "Your Digital House verification code",
    text: `Your verification code is ${otp}. It expires in ${expiresMinutes} minutes. Welcome to the community!`
  });
}

/** Send approval notification to user after admin approves their account */
export async function sendApprovalEmail(
  to: string,
  fullName?: string | null,
  remarks?: string | null
): Promise<void> {
  const name = fullName ? ` ${fullName}` : "";
  const remarkLine = remarks?.trim()
    ? `\n\nRemarks: ${remarks.trim()}`
    : "";
  await mailer.sendMail({
    from: process.env.MAIL_FROM,
    to: to.toLowerCase().trim(),
    subject: "Your Digital House account has been approved",
    text: `Hi${name},\n\nYour Digital House account has been approved. You can now sign in with your email and use the one-time code sent to your inbox. Welcome to the community!${remarkLine}\n\n— Digital House`
  });
}

/** Send rejection notification to user after admin rejects their account */
export async function sendRejectionEmail(
  to: string,
  fullName?: string | null,
  remarks?: string | null
): Promise<void> {
  const name = fullName ? ` ${fullName}` : "";
  const remarkLine = remarks?.trim()
    ? `\n\nReason: ${remarks.trim()}`
    : "\n\nPlease contact support if you have questions.";
  await mailer.sendMail({
    from: process.env.MAIL_FROM,
    to: to.toLowerCase().trim(),
    subject: "Your Digital House account was not approved",
    text: `Hi${name},\n\nAfter review, your Digital House account was not approved at this time.${remarkLine}\n\n— Digital House`
  });
}
