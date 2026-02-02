import nodemailer from "nodemailer";
import "../config/env";

// Timeouts so mail doesn't hang on Railway (e.g. blocked port, wrong host, slow provider)
const CONNECTION_TIMEOUT_MS = 10000;
const GREETING_TIMEOUT_MS = 5000;

export const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE) === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  connectionTimeout: CONNECTION_TIMEOUT_MS,
  greetingTimeout: GREETING_TIMEOUT_MS
});

