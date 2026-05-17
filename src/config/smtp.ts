import nodemailer from "nodemailer";
import type Transporter from "nodemailer/lib/mailer";

export type SmtpEncryption = "tls" | "ssl" | "none";

const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 5_000;
const SOCKET_TIMEOUT_MS = 25_000;

/** Resolve encryption: SMTP_ENCRYPTION (tls|ssl|none) or legacy SMTP_SECURE=true → ssl */
export function getSmtpEncryption(): SmtpEncryption {
  const raw = (process.env.SMTP_ENCRYPTION || "").trim().toLowerCase();
  if (raw === "ssl" || raw === "tls" || raw === "none") {
    return raw;
  }
  if (String(process.env.SMTP_SECURE).toLowerCase() === "true") {
    return "ssl";
  }
  return "tls";
}

/** Sender header — supports "Name <email@domain.com>" or plain address */
export function getSmtpFrom(): string | null {
  const from =
    process.env.SMTP_FROM?.trim() ||
    process.env.MAIL_FROM?.trim() ||
    process.env.EMAIL_FROM?.trim();
  return from || null;
}

export function validateSmtpConfig(): string | null {
  if (!process.env.SMTP_HOST?.trim()) return "SMTP_HOST is not set";
  if (!process.env.SMTP_USER?.trim()) return "SMTP_USER is not set";
  if (!process.env.SMTP_PASS?.trim()) return "SMTP_PASS is not set";
  if (!getSmtpFrom()) return "SMTP_FROM is not set";
  const port = Number(process.env.SMTP_PORT);
  if (process.env.SMTP_PORT && (Number.isNaN(port) || port < 1 || port > 65535)) {
    return "SMTP_PORT is invalid";
  }
  return null;
}

let cachedTransporter: Transporter | null = null;

export function getSmtpTransporter(): { transporter: Transporter } | { error: string } {
  const configError = validateSmtpConfig();
  if (configError) {
    return { error: configError };
  }

  if (cachedTransporter) {
    return { transporter: cachedTransporter };
  }

  const encryption = getSmtpEncryption();
  const port = Number(process.env.SMTP_PORT) || (encryption === "ssl" ? 465 : 587);

  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST!.trim(),
    port,
    secure: encryption === "ssl",
    auth: {
      user: process.env.SMTP_USER!.trim(),
      pass: process.env.SMTP_PASS!
    },
    requireTLS: encryption === "tls",
    ignoreTLS: encryption === "none",
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS
  });

  return { transporter: cachedTransporter };
}

/** Close pooled connection (tests / graceful shutdown) */
export function closeSmtpTransporter(): void {
  if (cachedTransporter) {
    cachedTransporter.close();
    cachedTransporter = null;
  }
}
