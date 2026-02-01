import { Request, Response, NextFunction } from "express";
import { error } from "../utils/response";
import { verifyAdminToken } from "../utils/jwt.util";

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

/**
 * Protect admin routes: require X-Admin-Key, or Authorization: Bearer <JWT> (admin login token).
 */
export function adminMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.trim().toLowerCase().startsWith("bearer ");
  const token = bearer ? authHeader!.trim().slice(7).trim() : null;

  // 1) Try JWT (admin login)
  if (token) {
    try {
      const decoded = verifyAdminToken(token);
      (req as any).adminEmail = decoded.email;
      return next();
    } catch (_) {
      // Not a valid admin JWT; fall through to API key
    }
  }

  // 2) X-Admin-Key or Bearer as API key
  const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
  if (!ADMIN_API_KEY) {
    return error(res, "Admin API key not configured. Set ADMIN_API_KEY in .env", 500);
  }
  const expectedRaw = normalizeKey(ADMIN_API_KEY);
  const expectedHex = normalizeHexKey(expectedRaw);
  let key: string | undefined;
  const rawHeader = req.headers["x-admin-key"];
  if (rawHeader != null) key = normalizeKey(String(rawHeader));
  if (!key && token) key = normalizeKey(token);
  const keyHex = key ? normalizeHexKey(key) : "";
  const match =
    key === expectedRaw ||
    (expectedHex && keyHex && keyHex === expectedHex);
  if (!key || !match) {
    return error(res, "Unauthorized. Use admin login or X-Admin-Key.", 401);
  }
  next();
}
