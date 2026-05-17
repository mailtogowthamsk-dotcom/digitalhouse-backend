import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { getSmtpFrom, getSmtpTransporter } from "../config/smtp";

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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Mail send timeout after ${ms}ms`)), ms)
    )
  ]);
}

function formatSmtpError(err: unknown): string {
  const e = err as {
    message?: string;
    code?: string;
    response?: string;
    responseCode?: number;
  };
  const parts = [e.code, e.message, e.response].filter(Boolean);
  return parts.length ? parts.join(" — ") : String(err);
}

/**
 * Send a single transactional email via SMTP (OTP, approvals, etc.).
 */
export async function sendMail(options: SendMailOptions): Promise<SendMailResult> {
  const transportResult = getSmtpTransporter();
  if ("error" in transportResult) {
    console.error("[SMTP] Configuration error:", transportResult.error);
    return { success: false, error: transportResult.error };
  }

  const from = getSmtpFrom();
  if (!from) {
    const msg = "SMTP_FROM is not set";
    console.error("[SMTP] Configuration error:", msg);
    return { success: false, error: msg };
  }

  const to = options.to.toLowerCase().trim();

  try {
    const info = await withTimeout(
      transportResult.transporter.sendMail({
        from,
        to,
        subject: options.subject,
        text: options.text,
        ...(options.html ? { html: options.html } : {})
      }),
      SEND_TIMEOUT_MS
    );

    const smtpInfo = info as SMTPTransport.SentMessageInfo;
    const messageId = smtpInfo.messageId;
    return { success: true, messageId };
  } catch (err) {
    const error = formatSmtpError(err);
    console.error("[SMTP] Failed to send email", {
      to,
      subject: options.subject,
      error
    });
    return { success: false, error };
  }
  
}
