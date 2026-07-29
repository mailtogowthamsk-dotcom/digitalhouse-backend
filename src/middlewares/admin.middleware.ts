import { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { error } from "../utils/response";
import { verifyAdminToken } from "../utils/jwt.util";
import {
  resolveAdminRole,
  isDeactivatedDbAdmin,
  isKnownAdminEmail
} from "../services/AdminRoles.service";

export type AdminAuthMethod = "jwt" | "api_key";

/** Normalize: trim and strip line endings + control chars */
function normalizeKey(value: string): string {
  return String(value)
    .replace(/\r/g, "")
    .replace(/\n/g, "")
    .replace(/\uFEFF/g, "")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim();
}

/** For 64-char hex keys only: compare using just hex chars (ignores any hidden char in Postman/.env) */
function normalizeHexKey(value: string): string {
  const hexOnly = value.replace(/[^a-fA-F0-9]/g, "");
  return hexOnly.length === 64 ? hexOnly.toLowerCase() : "";
}

function looksLikeJwt(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

function safeKeyEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  try {
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

const WEAK_API_KEYS = new Set([
  "",
  "admin",
  "password",
  "secret",
  "your_admin_api_key_here",
  "change_me",
  "changeme"
]);

export function isWeakAdminApiKey(key: string | undefined | null): boolean {
  const k = normalizeKey(key || "");
  if (!k) return true;
  if (WEAK_API_KEYS.has(k.toLowerCase())) return true;
  if (k.length < 16) return true;
  return false;
}

/**
 * Protect admin routes: require X-Admin-Key, or Authorization: Bearer <JWT> (admin login token).
 *
 * Role for JWT sessions is always resolved live from admin_users (DB cache) / whitelist defaults.
 * The role claim inside the JWT is ignored for authorization so demotions/promotions apply
 * immediately without waiting for token expiry.
 *
 * API key role comes from ADMIN_API_KEY_ROLE (default SUPER_ADMIN). Bearer tokens that look like
 * JWTs are never treated as API keys (must use X-Admin-Key for key auth).
 */
export function adminMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.trim().toLowerCase().startsWith("bearer ");
  const token = bearer ? authHeader!.trim().slice(7).trim() : null;

  // 1) Try JWT (admin login)
  if (token && looksLikeJwt(token)) {
    try {
      const decoded = verifyAdminToken(token);
      const email = String(decoded.email || "")
        .trim()
        .toLowerCase();
      if (!email || !email.includes("@")) {
        return error(res, "Invalid admin session.", 401);
      }
      if (!isKnownAdminEmail(email)) {
        return error(res, "Admin session is no longer valid.", 401);
      }
      if (isDeactivatedDbAdmin(email)) {
        return error(res, "Admin account deactivated.", 403);
      }
      (req as any).adminEmail = email;
      (req as any).adminAuthMethod = "jwt" as AdminAuthMethod;
      // Live role — do not trust stale JWT role claim
      const role = resolveAdminRole(email);
      (req as any).adminRole = role;
      (req as any)._resolvedAdminRole = role;
      return next();
    } catch (_) {
      return error(res, "Unauthorized. Use admin login or X-Admin-Key.", 401);
    }
  }

  // 2) X-Admin-Key (preferred) or Bearer as opaque API key (non-JWT only)
  const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
  if (!ADMIN_API_KEY) {
    return error(res, "Admin API key not configured. Set ADMIN_API_KEY in .env", 500);
  }
  if (process.env.NODE_ENV === "production" && isWeakAdminApiKey(ADMIN_API_KEY)) {
    return error(
      res,
      "ADMIN_API_KEY is weak or a placeholder. Set a strong key (16+ chars) in production.",
      500
    );
  }

  const expectedRaw = normalizeKey(ADMIN_API_KEY);
  const expectedHex = normalizeHexKey(expectedRaw);
  let key: string | undefined;
  const rawHeader = req.headers["x-admin-key"];
  if (rawHeader != null) key = normalizeKey(String(rawHeader));
  // Only accept Bearer as API key when it does not look like a JWT
  if (!key && token && !looksLikeJwt(token)) key = normalizeKey(token);
  if (!key) {
    return error(res, "Unauthorized. Use admin login or X-Admin-Key.", 401);
  }

  const keyHex = normalizeHexKey(key);
  const match =
    safeKeyEqual(key, expectedRaw) ||
    Boolean(expectedHex && keyHex && safeKeyEqual(keyHex, expectedHex));
  if (!match) {
    return error(res, "Unauthorized. Use admin login or X-Admin-Key.", 401);
  }

  (req as any).adminEmail = null;
  (req as any).adminAuthMethod = "api_key" as AdminAuthMethod;
  const role = resolveAdminRole(null);
  (req as any).adminRole = role;
  (req as any)._resolvedAdminRole = role;
  next();
}
