/**
 * Safe SMTP connectivity check — prints status only, never credentials.
 * Usage: node --import tsx scripts/smtp-verify.ts
 */
import "../src/config/env";
import {
  validateSmtpConfig,
  verifySmtpConnection,
  closeSmtpTransporter,
  getSmtpPort,
  getSmtpEncryption
} from "../src/config/smtp";

async function main() {
  const cfgErr = validateSmtpConfig();
  if (cfgErr) {
    console.log("CONFIG_FAIL", cfgErr);
    process.exitCode = 1;
    return;
  }
  console.log("CONFIG_OK", {
    hostSet: Boolean(process.env.SMTP_HOST?.trim()),
    port: getSmtpPort(),
    encryption: getSmtpEncryption(),
    userSet: Boolean(process.env.SMTP_USER?.trim()),
    fromSet: Boolean(process.env.SMTP_FROM?.trim() || process.env.MAIL_FROM?.trim()),
    passSet: Boolean(process.env.SMTP_PASS || process.env.SMTP_PASSWORD)
  });

  const result = await verifySmtpConnection();
  if (result.ok) {
    console.log("VERIFY_OK");
  } else {
    console.log("VERIFY_FAIL", result.error);
    process.exitCode = 1;
  }
  closeSmtpTransporter();
}

main().catch((e) => {
  console.log("VERIFY_ERROR", e instanceof Error ? e.message : "unknown");
  process.exitCode = 1;
  closeSmtpTransporter();
});
