/**
 * Production security gate — fail fast when critical config is missing/weak.
 * Import once at process start (before accepting traffic).
 */
import { logSecurityEvent } from "../utils/securityLog";

const WEAK_PEPPERS = new Set(["", "dev-pepper", "change_me", "secret", "pepper"]);
const WEAK_ADMIN_KEYS = new Set([
  "admin",
  "password",
  "secret",
  "changeme",
  "change_me",
  "test",
  "123456"
]);

function isWeakAdminKey(key: string): boolean {
  const k = key.trim();
  if (!k || k.length < 16) return true;
  return WEAK_ADMIN_KEYS.has(k.toLowerCase());
}

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

function missing(name: string): boolean {
  return !String(process.env[name] || "").trim();
}

function fail(errors: string[]): never {
  for (const e of errors) {
    console.error(`[security:startup] FATAL: ${e}`);
  }
  logSecurityEvent("security_startup_failure", { count: errors.length });
  throw new Error(
    `Production security validation failed (${errors.length} issue(s)). Fix env and restart.\n` +
      errors.map((e) => `  - ${e}`).join("\n")
  );
}

/**
 * Validate production-critical environment. Safe no-op outside production.
 * Call after dotenv load; before listen().
 */
export function assertProductionSecurityEnv(): void {
  if (!isProd()) {
    if (!process.env.OTP_HASH_PEPPER?.trim()) {
      console.warn("[security] OTP_HASH_PEPPER unset — using development fallback (dev only).");
    }
    if (!process.env.ADMIN_JWT_SECRET?.trim() && !process.env.JWT_ADMIN_SECRET?.trim()) {
      console.warn(
        "[security] ADMIN_JWT_SECRET unset — admin JWTs fall back to member secret (dev only)."
      );
    }
    return;
  }

  const errors: string[] = [];

  const memberSecret = (
    process.env.JWT_ACCESS_SECRET ||
    process.env.JWT_SECRET ||
    ""
  ).trim();
  if (!memberSecret || memberSecret === "change_me_access") {
    errors.push("JWT_ACCESS_SECRET (or JWT_SECRET) must be set to a strong non-default value.");
  }

  const adminJwt = (process.env.ADMIN_JWT_SECRET || process.env.JWT_ADMIN_SECRET || "").trim();
  if (!adminJwt) {
    errors.push(
      "ADMIN_JWT_SECRET is required in production (must not reuse the member JWT secret)."
    );
  } else if (memberSecret && adminJwt === memberSecret) {
    errors.push(
      "ADMIN_JWT_SECRET must differ from JWT_ACCESS_SECRET / JWT_SECRET in production."
    );
  }

  const pepper = (process.env.OTP_HASH_PEPPER || "").trim();
  if (!pepper || WEAK_PEPPERS.has(pepper.toLowerCase())) {
    errors.push(
      "OTP_HASH_PEPPER is required in production and must not be a weak/default value (e.g. not \"dev-pepper\")."
    );
  }

  if (process.env.ADMIN_PASSWORD?.trim()) {
    errors.push(
      "ADMIN_PASSWORD is not allowed in production. Use hashed admin_users accounts and remove ADMIN_PASSWORD from the environment."
    );
  }

  const adminKey = (process.env.ADMIN_API_KEY || "").trim();
  if (!adminKey) {
    errors.push("ADMIN_API_KEY is required in production.");
  } else if (isWeakAdminKey(adminKey)) {
    errors.push("ADMIN_API_KEY looks weak or is a placeholder — use a long random secret.");
  }

  for (const name of ["DB_HOST", "DB_USER", "DB_NAME"] as const) {
    if (missing(name)) errors.push(`${name} is required in production.`);
  }
  if (missing("DB_PASSWORD") && process.env.ALLOW_EMPTY_DB_PASSWORD !== "true") {
    errors.push("DB_PASSWORD is required in production (set ALLOW_EMPTY_DB_PASSWORD=true only if intentional).");
  }

  for (const name of [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME"
  ] as const) {
    if (missing(name)) errors.push(`${name} is required in production.`);
  }

  if (missing("RAZORPAY_KEY_ID") || missing("RAZORPAY_KEY_SECRET")) {
    if (process.env.ALLOW_MISSING_RAZORPAY === "true") {
      console.warn(
        "[security] RAZORPAY_KEY_ID/SECRET missing — allowed only because ALLOW_MISSING_RAZORPAY=true."
      );
    } else {
      errors.push(
        "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required in production (or set ALLOW_MISSING_RAZORPAY=true)."
      );
    }
  }

  if (missing("RAZORPAY_WEBHOOK_SECRET") && process.env.ALLOW_MISSING_RAZORPAY !== "true") {
    console.warn(
      "[security] RAZORPAY_WEBHOOK_SECRET unset — webhook signature verification will fail."
    );
  }

  const googleIds = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_WEB_CLIENT_ID,
    process.env.GOOGLE_IOS_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID
  ].some((v) => String(v || "").trim());
  if (!googleIds) {
    if (process.env.ALLOW_MISSING_GOOGLE_OAUTH === "true") {
      console.warn("[security] Google OAuth client IDs missing — Google sign-in disabled.");
    } else {
      console.warn(
        "[security] No GOOGLE_*_CLIENT_ID set — Google sign-in will fail. Set ALLOW_MISSING_GOOGLE_OAUTH=true to silence."
      );
    }
  }

  if (missing("REDIS_URL")) {
    if (process.env.REDIS_REQUIRED === "true") {
      errors.push("REDIS_URL is required (REDIS_REQUIRED=true). Needed for multi-instance OTP locks + token revocation.");
    } else {
      console.warn(
        "[security] REDIS_URL unset — OTP attempt counters and token revocation are single-instance only. Set REDIS_REQUIRED=true to enforce."
      );
    }
  }

  if (errors.length) fail(errors);

  console.log("[security] Production environment validation passed.");
}
