import sgMail from "@sendgrid/mail";

/** HTTP API timeout — avoids hung requests if SendGrid is slow or unreachable */
const SEND_TIMEOUT_MS = 25_000;

export type SendMailResult =
  | { success: true; messageId?: string }
  | { success: false; error: string };

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let sendGridInitialized = false;

function initSendGrid(): string | null {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  if (!apiKey) {
    return "SENDGRID_API_KEY is not set";
  }
  if (!sendGridInitialized) {
    sgMail.setApiKey(apiKey);
    sendGridInitialized = true;
  }
  return null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Mail send timeout after ${ms}ms`)), ms)
    )
  ]);
}

/** Normalize SendGrid / network errors into a single log-friendly string */
function formatSendGridError(err: unknown): string {
  const e = err as {
    message?: string;
    response?: { body?: { errors?: Array<{ message?: string }> } };
  };
  const apiErrors = e.response?.body?.errors;
  if (apiErrors?.length) {
    return apiErrors.map((item) => item.message || "Unknown SendGrid error").join("; ");
  }
  return e.message || String(err);
}

/**
 * Send a single transactional email via SendGrid Web API.
 * Designed for high volume (OTP, approvals): one HTTP call per message, no SMTP connection pool.
 */
export async function sendMail(options: SendMailOptions): Promise<SendMailResult> {
  const configError = initSendGrid();
  if (configError) {
    console.error("[SendGrid] Configuration error:", configError);
    return { success: false, error: configError };
  }

  const from = process.env.EMAIL_FROM?.trim();
  if (!from) {
    const msg = "EMAIL_FROM is not set";
    console.error("[SendGrid] Configuration error:", msg);
    return { success: false, error: msg };
  }

  const to = options.to.toLowerCase().trim();

  try {
    const [response] = await withTimeout(
      sgMail.send({
        to,
        from,
        subject: options.subject,
        text: options.text,
        ...(options.html ? { html: options.html } : {})
      }),
      SEND_TIMEOUT_MS
    );

    const messageId = response.headers["x-message-id"] as string | undefined;
    return { success: true, messageId };
  } catch (err) {
    const error = formatSendGridError(err);
    console.error("[SendGrid] Failed to send email", {
      to,
      subject: options.subject,
      error
    });
    return { success: false, error };
  }
}
