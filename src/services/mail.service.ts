import { sendMail } from "../utils/sendMail";

async function sendOrThrow(
  to: string,
  subject: string,
  text: string,
  emailType: string
): Promise<void> {
  const result = await sendMail({ to, subject, text, emailType });
  if (!result.success) {
    throw new Error(result.error);
  }
}

/** Send OTP email to user (community-friendly copy). */
export async function sendOtpEmail(to: string, otp: string, expiresMinutes: number): Promise<void> {
  await sendOrThrow(
    to,
    "Your Digital House verification code",
    `Your verification code is ${otp}. It expires in ${expiresMinutes} minutes. Welcome to the community!`,
    "otp"
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
    `Hi${name},\n\nYour Digital House account has been approved. Please sign in again with OTP or Google to start using the app. Welcome to the community!${remarkLine}\n\n— Digital House`,
    "registration_approved"
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
    `Hi${name},\n\nAfter review, your Digital House account was not approved at this time.${remarkLine}\n\n— Digital House`,
    "registration_rejected"
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
    `Hi${name},\n\nYour registration requires changes. Please update the requested information and submit again.${remarkLine}\n\nSign in to Digital House to make corrections.\n\n— Digital House`,
    "registration_changes"
  );
}

export type WebsiteContactPayload = {
  name: string;
  email: string;
  subject: string;
  message: string;
};

/** Public website contact form → inbox (reuses SMTP sendMail). */
export async function sendWebsiteContactEmail(payload: WebsiteContactPayload): Promise<void> {
  const to = (process.env.WEBSITE_CONTACT_TO || "contact@konguvettuvagounder.com")
    .trim()
    .toLowerCase();
  const fromName = payload.name.trim();
  const fromEmail = payload.email.trim().toLowerCase();
  const subjectLine = payload.subject.trim();
  const body = [
    "New message from konguvettuvagounder.com contact form",
    "",
    `Name: ${fromName}`,
    `Email: ${fromEmail}`,
    `Subject: ${subjectLine}`,
    "",
    payload.message.trim(),
    "",
    "— Kongu Vettuva Gounder website"
  ].join("\n");

  const result = await sendMail({
    to,
    subject: `[Website] ${subjectLine}`,
    text: body,
    replyTo: fromEmail,
    emailType: "website_contact"
  });
  if (!result.success) {
    throw new Error(result.error);
  }
}
