import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { getSmtpFrom, getSmtpTransporter } from "../config/smtp";

const SEND_TIMEOUT_MS = 25_000;
const TEMP_RETRY_DELAY_MS = 400;
const MAX_TEMP_ATTEMPTS = 2;

export type SendMailResult =
  | { success: true; messageId?: string }
  | { success: false; error: string; category?: SmtpErrorCategory };

export type SmtpErrorCategory = "temporary" | "permanent" | "config" | "unknown";

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** When set, replies go to this address (e.g. website contact form). */
  replyTo?: string;
  /** Log label only — never include secrets or full body. */
  emailType?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Mail send timeout after ${ms}ms`)), ms)
    )
  ]);
}

function maskEmail(email: string): string {
  const e = email.toLowerCase().trim();
  const at = e.indexOf("@");
  if (at <= 0) return "***";
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const localMasked =
    local.length <= 2 ? `${local[0] || "*"}*` : `${local[0]}***${local[local.length - 1]}`;
  return `${localMasked}@${domain}`;
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

export function classifySmtpError(err: unknown): SmtpErrorCategory {
  const e = err as {
    message?: string;
    code?: string;
    responseCode?: number;
    response?: string;
  };
  const code = String(e.code || "").toUpperCase();
  const msg = `${e.message || ""} ${e.response || ""}`.toLowerCase();
  const rc = e.responseCode;

  if (
    code === "ECONNECTION" ||
    code === "ETIMEDOUT" ||
    code === "ESOCKET" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    (code === "EENVELOPE" && msg.includes("timeout")) ||
    msg.includes("timeout") ||
    msg.includes("temporarily") ||
    (typeof rc === "number" && rc >= 400 && rc < 500)
  ) {
    return "temporary";
  }

  if (
    code === "EAUTH" ||
    code === "EENVELOPE" ||
    msg.includes("invalid login") ||
    msg.includes("authentication failed") ||
    (typeof rc === "number" && rc >= 500)
  ) {
    return "permanent";
  }

  if (msg.includes("is not configured") || msg.includes("is not set")) {
    return "config";
  }

  return "unknown";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send a single transactional email via the shared SMTP transporter.
 * Temporary SMTP failures are retried once; permanent/config errors are not.
 */
export async function sendMail(options: SendMailOptions): Promise<SendMailResult> {
  const transportResult = getSmtpTransporter();
  if ("error" in transportResult) {
    console.error("[SMTP] Configuration error:", transportResult.error);
    return { success: false, error: transportResult.error, category: "config" };
  }

  const from = getSmtpFrom();
  if (!from) {
    const msg = "SMTP_FROM is not configured";
    console.error("[SMTP] Configuration error:", msg);
    return { success: false, error: msg, category: "config" };
  }

  const to = options.to.toLowerCase().trim();
  const emailType = options.emailType || "transactional";
  const replyTo = options.replyTo?.trim() || undefined;

  let lastError = "";
  let lastCategory: SmtpErrorCategory = "unknown";

  for (let attempt = 1; attempt <= MAX_TEMP_ATTEMPTS; attempt++) {
    try {
      const info = await withTimeout(
        transportResult.transporter.sendMail({
          from,
          to,
          subject: options.subject,
          text: options.text,
          ...(options.html ? { html: options.html } : {}),
          ...(replyTo ? { replyTo } : {}),
          ...(options.attachments?.length ? { attachments: options.attachments } : {})
        }),
        SEND_TIMEOUT_MS
      );

      const smtpInfo = info as SMTPTransport.SentMessageInfo;
      const messageId = smtpInfo.messageId;
      console.log("[SMTP] Accepted", {
        emailType,
        to: maskEmail(to),
        messageId: messageId ?? null,
        attempt
      });
      return { success: true, messageId };
    } catch (err) {
      lastError = formatSmtpError(err);
      lastCategory = classifySmtpError(err);
      console.error("[SMTP] Failed to send email", {
        emailType,
        to: maskEmail(to),
        category: lastCategory,
        attempt,
        error: lastError
      });

      if (lastCategory !== "temporary" || attempt >= MAX_TEMP_ATTEMPTS) {
        break;
      }
      await sleep(TEMP_RETRY_DELAY_MS);
    }
  }

  return { success: false, error: lastError, category: lastCategory };
}

/** Alias used by callers that prefer a generic name. */
export const sendEmail = sendMail;
