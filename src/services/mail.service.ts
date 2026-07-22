import { sendMail } from "../utils/sendMail";

async function sendOrThrow(
  to: string,
  subject: string,
  text: string
): Promise<void> {
  const result = await sendMail({ to, subject, text });
  if (!result.success) {
    throw new Error(result.error);
  }
}

/** Send OTP email to user (community-friendly copy). */
export async function sendOtpEmail(to: string, otp: string, expiresMinutes: number): Promise<void> {
  await sendOrThrow(
    to,
    "Your Digital House verification code",
    `Your verification code is ${otp}. It expires in ${expiresMinutes} minutes. Welcome to the community!`
  );
}

/** Send approval notification to user after admin approves their account */
export async function sendApprovalEmail(
  to: string,
  fullName?: string | null,
  remarks?: string | null
): Promise<void> {
  const name = fullName ? ` ${fullName}` : "";
  const remarkLine = remarks?.trim() ? `\n\nRemarks: ${remarks.trim()}` : "";
  await sendOrThrow(
    to,
    "Your Digital House account has been approved",
    `Hi${name},\n\nYour Digital House account has been approved. You can now sign in with your email and use the one-time code sent to your inbox. Welcome to the community!${remarkLine}\n\n— Digital House`
  );
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
  await sendOrThrow(
    to,
    "Your Digital House account was not approved",
    `Hi${name},\n\nAfter review, your Digital House account was not approved at this time.${remarkLine}\n\n— Digital House`
  );
}

/** Notify user that admin requested registration corrections. */
export async function sendRegistrationChangesEmail(
  to: string,
  fullName?: string | null,
  remarks?: string | null
): Promise<void> {
  const name = fullName ? ` ${fullName}` : "";
  const remarkLine = remarks?.trim()
    ? `\n\nWhat to update:\n${remarks.trim()}`
    : "\n\nPlease update the requested information and submit again.";
  await sendOrThrow(
    to,
    "Your Digital House registration requires changes",
    `Hi${name},\n\nYour registration requires changes. Please update the requested information and submit again.${remarkLine}\n\nSign in to Digital House to make corrections.\n\n— Digital House`
  );
}
