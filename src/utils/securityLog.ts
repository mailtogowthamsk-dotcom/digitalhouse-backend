/**
 * Security audit logger — never log secrets, OTPs, tokens, or passwords.
 */
type SecurityEvent =
  | "otp_verify_failed"
  | "otp_locked"
  | "otp_verify_success"
  | "admin_login_failed"
  | "admin_login_lockout"
  | "admin_legacy_password_blocked"
  | "dev_payments_blocked"
  | "dev_payments_misconfig"
  | "jwt_invalid"
  | "socket_query_token"
  | "login_unknown_email"
  | "login_blocked"
  | "token_revoked"
  | "webhook_invalid"
  | "permission_denied"
  | "security_startup_failure";

export function logSecurityEvent(
  event: SecurityEvent,
  detail: Record<string, string | number | boolean | null | undefined> = {}
): void {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (v === undefined) continue;
    const key = k.toLowerCase();
    if (
      key === "password" ||
      key === "secret" ||
      key === "token" ||
      key === "otp" ||
      key === "code" ||
      key === "signature" ||
      key === "authorization" ||
      key.endsWith("_password") ||
      key.endsWith("_secret") ||
      key.endsWith("_token") ||
      key.includes("otp_code") ||
      key.includes("access_token")
    ) {
      continue;
    }
    safe[k] = v as string | number | boolean | null;
  }
  console.warn(`[security] ${event}`, safe);
}
