import nodemailer from "nodemailer";
import type Transporter from "nodemailer/lib/mailer";

export type SmtpEncryption = "tls" | "ssl" | "none";

const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 5_000;
const SOCKET_TIMEOUT_MS = 25_000;

/** Soft pool — enough for OTP bursts without over-opening Mailcow. */
const POOL_MAX_CONNECTIONS = 3;
const POOL_MAX_MESSAGES = 100;

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

/** Prefer SMTP_PASS (project convention); accept SMTP_PASSWORD as alias. */
export function getSmtpPassword(): string | null {
  const pass = process.env.SMTP_PASS ?? process.env.SMTP_PASSWORD;
  if (pass == null) return null;
  const trimmed = String(pass);
  return trimmed.length ? trimmed : null;
}

export function getSmtpFromName(): string | null {
  const name = process.env.SMTP_FROM_NAME?.trim();
  return name || null;
}

/**
 * Sender header — supports "Name <email@domain.com>" or plain address.
 * When SMTP_FROM_NAME is set, it is applied to the address part of SMTP_FROM / MAIL_FROM.
 */
export function getSmtpFrom(): string | null {
  const fromRaw =
    process.env.SMTP_FROM?.trim() ||
    process.env.MAIL_FROM?.trim() ||
    process.env.EMAIL_FROM?.trim();
  if (!fromRaw) return null;

  const fromName = getSmtpFromName();
  if (!fromName) return fromRaw;

  const angle = fromRaw.match(/<([^>]+)>/);
  const email = (angle?.[1] || fromRaw).trim();
  if (!email.includes("@")) return fromRaw;
  return `${fromName} <${email}>`;
}

export function getSmtpPort(): number {
  const encryption = getSmtpEncryption();
  const configured = Number(process.env.SMTP_PORT);
  if (process.env.SMTP_PORT && !Number.isNaN(configured) && configured >= 1 && configured <= 65535) {
    return configured;
  }
  return encryption === "ssl" ? 465 : 587;
}

/** Returns missing/invalid VARIABLE NAME messages only — never secret values. */
export function validateSmtpConfig(): string | null {
  if (!process.env.SMTP_HOST?.trim()) return "SMTP_HOST is not configured";
  if (!process.env.SMTP_USER?.trim()) return "SMTP_USER is not configured";
  if (!getSmtpPassword()) return "SMTP_PASS is not configured";
  if (!getSmtpFrom()) return "SMTP_FROM is not configured";
  if (!getSmtpFromName() && process.env.NODE_ENV === "production") {
    // Soft requirement in prod for branding; still allow MAIL_FROM "Name <email>" alone
    const raw = process.env.SMTP_FROM?.trim() || process.env.MAIL_FROM?.trim() || "";
    if (!/<[^>]+>/.test(raw) && !process.env.SMTP_FROM_NAME?.trim()) {
      return "SMTP_FROM_NAME is not configured";
    }
  }
  if (process.env.SMTP_PORT) {
    const port = Number(process.env.SMTP_PORT);
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      return "SMTP_PORT is invalid";
    }
  }
  return null;
}

/**
 * Startup gate: in production, incomplete SMTP config exits the process.
 * Development logs a warning and continues (OTP can still fail at send time).
 */
export function assertSmtpConfigAtStartup(): void {
  const err = validateSmtpConfig();
  if (!err) {
    const encryption = getSmtpEncryption();
    console.log("[SMTP] Config OK", {
      host: process.env.SMTP_HOST?.trim(),
      port: getSmtpPort(),
      encryption,
      secure: encryption === "ssl",
      user: process.env.SMTP_USER?.trim(),
      from: getSmtpFrom()
    });
    return;
  }
  if (process.env.NODE_ENV === "production") {
    console.error(`[SMTP] Fatal: ${err}`);
    process.exit(1);
  }
  console.warn(`[SMTP] ${err} — transactional email will fail until configured.`);
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
  const port = getSmtpPort();
  const password = getSmtpPassword()!;

  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST!.trim(),
    port,
    secure: encryption === "ssl",
    auth: {
      user: process.env.SMTP_USER!.trim(),
      pass: password
    },
    requireTLS: encryption === "tls",
    ignoreTLS: encryption === "none",
    pool: true,
    maxConnections: POOL_MAX_CONNECTIONS,
    maxMessages: POOL_MAX_MESSAGES,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS
    // Do NOT set tls.rejectUnauthorized: false — Mailcow must present a valid cert.
  });

  return { transporter: cachedTransporter };
}

/** SMTP AUTH + connection check (no message sent). Never logs credentials. */
export async function verifySmtpConnection(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const transportResult = getSmtpTransporter();
  if ("error" in transportResult) {
    return { ok: false, error: transportResult.error };
  }
  try {
    await transportResult.transporter.verify();
    return { ok: true };
  } catch (err) {
    const e = err as { message?: string; code?: string; responseCode?: number };
    const parts = [e.code, e.message].filter(Boolean);
    return { ok: false, error: parts.join(" — ") || "SMTP verify failed" };
  }
}

/** Close pooled connection (tests / graceful shutdown) */
export function closeSmtpTransporter(): void {
  if (cachedTransporter) {
    cachedTransporter.close();
    cachedTransporter = null;
  }
}
