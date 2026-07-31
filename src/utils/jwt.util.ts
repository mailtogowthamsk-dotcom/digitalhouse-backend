import jwt from "jsonwebtoken";
import { logSecurityEvent } from "./securityLog";

const DEFAULT_DEV_SECRET = "change_me_access";

const rawMemberSecret = (
  process.env.JWT_ACCESS_SECRET ||
  process.env.JWT_SECRET ||
  ""
).trim();

if (
  process.env.NODE_ENV === "production" &&
  (!rawMemberSecret || rawMemberSecret === DEFAULT_DEV_SECRET)
) {
  throw new Error(
    "JWT_ACCESS_SECRET (or JWT_SECRET) must be set to a strong secret in production (not the default)."
  );
}

const memberSecret = rawMemberSecret || DEFAULT_DEV_SECRET;

const rawAdminSecret = (
  process.env.ADMIN_JWT_SECRET ||
  process.env.JWT_ADMIN_SECRET ||
  ""
).trim();

if (process.env.NODE_ENV === "production") {
  if (!rawAdminSecret) {
    throw new Error(
      "ADMIN_JWT_SECRET must be set in production and must not fall back to the member JWT secret."
    );
  }
  if (rawAdminSecret === memberSecret) {
    throw new Error(
      "ADMIN_JWT_SECRET must be different from JWT_ACCESS_SECRET / JWT_SECRET in production."
    );
  }
}

const adminSecret = rawAdminSecret || memberSecret;

let warnedSharedAdminSecret = false;
export function warnIfAdminJwtSecretMissing(): void {
  if (warnedSharedAdminSecret) return;
  if (!rawAdminSecret) {
    warnedSharedAdminSecret = true;
    console.warn(
      "[security] ADMIN_JWT_SECRET not set — admin JWTs fall back to member JWT secret (development only)."
    );
  }
}

function buildVerifyOpts(): jwt.VerifyOptions {
  const opts: jwt.VerifyOptions = {
    algorithms: ["HS256"] // reject "none" and others
  };
  const issuer = (process.env.JWT_ISSUER || "").trim();
  const audience = (process.env.JWT_AUDIENCE || "").trim();
  if (issuer) opts.issuer = issuer;
  if (audience) opts.audience = audience;
  return opts;
}

const VERIFY_OPTS = buildVerifyOpts();

function buildSignOpts(expiresIn: string): jwt.SignOptions {
  const opts: jwt.SignOptions = {
    algorithm: "HS256",
    expiresIn: expiresIn as jwt.SignOptions["expiresIn"]
  };
  const issuer = (process.env.JWT_ISSUER || "").trim();
  const audience = (process.env.JWT_AUDIENCE || "").trim();
  if (issuer) opts.issuer = issuer;
  if (audience) opts.audience = audience;
  return opts;
}

/** Member access token. `tv` reserved for future DB-backed versioning (defaults 0). */
export function signAccessToken(payload: { userId: number; tv?: number }) {
  return jwt.sign(
    { userId: payload.userId, tv: payload.tv ?? 0 },
    memberSecret as jwt.Secret,
    buildSignOpts(process.env.JWT_ACCESS_EXPIRES_IN || "7d")
  );
}

export function verifyAccessToken(token: string): {
  userId: number;
  tv?: number;
  iat?: number;
  exp?: number;
} {
  if (!token || typeof token !== "string" || token.split(".").length !== 3) {
    logSecurityEvent("jwt_invalid", { kind: "member", reason: "malformed" });
    throw new Error("Malformed token");
  }
  try {
    return jwt.verify(token, memberSecret as jwt.Secret, VERIFY_OPTS) as {
      userId: number;
      tv?: number;
      iat?: number;
      exp?: number;
    };
  } catch (err) {
    logSecurityEvent("jwt_invalid", {
      kind: "member",
      reason: err instanceof Error ? err.name : "verify_failed"
    });
    throw err;
  }
}

/** Admin JWT — production requires ADMIN_JWT_SECRET (enforced above). */
export function signAdminToken(payload: { email: string; role?: string }) {
  warnIfAdminJwtSecretMissing();
  return jwt.sign(
    { ...payload, admin: true },
    adminSecret as jwt.Secret,
    buildSignOpts(process.env.JWT_ADMIN_EXPIRES_IN || "24h")
  );
}

export function verifyAdminToken(token: string): {
  email: string;
  admin: true;
  role?: string;
} {
  warnIfAdminJwtSecretMissing();
  if (!token || typeof token !== "string" || token.split(".").length !== 3) {
    logSecurityEvent("jwt_invalid", { kind: "admin", reason: "malformed" });
    throw new Error("Malformed token");
  }
  let decoded: {
    email?: string;
    admin?: boolean;
    role?: string;
    userId?: number;
  };
  try {
    decoded = jwt.verify(token, adminSecret as jwt.Secret, VERIFY_OPTS) as typeof decoded;
  } catch (firstErr) {
    // Transition: tokens minted with member secret before ADMIN_JWT_SECRET was set
    if (adminSecret !== memberSecret) {
      try {
        decoded = jwt.verify(token, memberSecret as jwt.Secret, VERIFY_OPTS) as typeof decoded;
        logSecurityEvent("jwt_invalid", {
          kind: "admin",
          reason: "legacy_member_secret_accepted"
        });
      } catch (err) {
        logSecurityEvent("jwt_invalid", {
          kind: "admin",
          reason: err instanceof Error ? err.name : "verify_failed"
        });
        throw err;
      }
    } else {
      logSecurityEvent("jwt_invalid", {
        kind: "admin",
        reason: firstErr instanceof Error ? firstErr.name : "verify_failed"
      });
      throw firstErr;
    }
  }
  if (!decoded.admin || !decoded.email || typeof decoded.email !== "string") {
    throw new Error("Invalid admin token");
  }
  if (decoded.userId != null) {
    throw new Error("Invalid admin token");
  }
  const email = decoded.email.trim().toLowerCase();
  if (!email) throw new Error("Invalid admin token");
  return { email, admin: true, role: decoded.role };
}
