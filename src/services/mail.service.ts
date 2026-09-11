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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Acknowledgment to the person who submitted the website contact form. */
async function sendWebsiteContactAckEmail(payload: WebsiteContactPayload): Promise<void> {
  const name = payload.name.trim() || "there";
  const subjectLine = payload.subject.trim();
  const support = (process.env.WEBSITE_CONTACT_TO || "contact@konguvettuvagounder.com")
    .trim()
    .toLowerCase();

  const text = [
    `Dear ${name},`,
    "",
    "Thank you for contacting Kongu Vettuva Gounder.",
    "",
    "We have received your message and our team will review it shortly. You can expect a response from us as soon as possible.",
    "",
    "For your reference, here is a copy of what you submitted:",
    `Subject: ${subjectLine}`,
    "",
    "If your enquiry is urgent, you may also write to us at " + support + ".",
    "",
    "With regards,",
    "Kongu Vettuva Gounder Team",
    "https://konguvettuvagounder.com"
  ].join("\n");

  const safeName = escapeHtml(name);
  const safeSubject = escapeHtml(subjectLine);
  const safeSupport = escapeHtml(support);

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#23201c;max-width:560px;margin:0 auto;padding:24px">
    <p style="margin:0 0 16px">Dear ${safeName},</p>
    <p style="margin:0 0 16px">Thank you for contacting <strong>Kongu Vettuva Gounder</strong>.</p>
    <p style="margin:0 0 16px">We have received your message and our team will review it shortly. You can expect a response from us as soon as possible.</p>
    <div style="margin:20px 0;padding:14px 16px;background:#f4f7f4;border-left:4px solid #128a3c;border-radius:6px">
      <p style="margin:0;font-size:13px;color:#6b645a">Your enquiry</p>
      <p style="margin:4px 0 0;font-weight:600">${safeSubject}</p>
    </div>
    <p style="margin:0 0 16px">If your enquiry is urgent, please write to us at
      <a href="mailto:${safeSupport}" style="color:#128a3c">${safeSupport}</a>.
    </p>
    <p style="margin:24px 0 0">With regards,<br>
      <strong>Kongu Vettuva Gounder Team</strong><br>
      <a href="https://konguvettuvagounder.com" style="color:#128a3c">konguvettuvagounder.com</a>
    </p>
  </div>`.trim();

  const result = await sendMail({
    to: payload.email.trim().toLowerCase(),
    subject: "We received your message — Kongu Vettuva Gounder",
    text,
    html,
    emailType: "website_contact_ack"
  });
  if (!result.success) {
    throw new Error(result.error);
  }
}

/** Public website contact form → inbox (reuses SMTP sendMail), then ack to submitter. */
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

  // Acknowledgment is best-effort — inbox delivery already succeeded.
  try {
    await sendWebsiteContactAckEmail(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[website/contact] acknowledgment email failed:", msg);
  }
}
