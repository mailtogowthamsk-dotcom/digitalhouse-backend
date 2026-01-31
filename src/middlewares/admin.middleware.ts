import { Request, Response, NextFunction } from "express";
import { error } from "../utils/response";

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
 * Protect admin routes: require X-Admin-Key or Authorization: Bearer to match ADMIN_API_KEY.
 */
export function adminMiddleware(req: Request, res: Response, next: NextFunction) {
  const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
  if (!ADMIN_API_KEY) {
    return error(res, "Admin API key not configured. Set ADMIN_API_KEY in .env", 500);
  }
  const expectedRaw = normalizeKey(ADMIN_API_KEY);
  const expectedHex = normalizeHexKey(expectedRaw);
  // Accept X-Admin-Key header
  let key: string | undefined;
  const rawHeader = req.headers["x-admin-key"];
  if (rawHeader != null) key = normalizeKey(String(rawHeader));
  if (!key && req.headers.authorization) {
    const auth = String(req.headers.authorization).trim();
    if (auth.toLowerCase().startsWith("bearer ")) key = normalizeKey(auth.slice(7));
  }
  const keyHex = key ? normalizeHexKey(key) : "";
  const match =
    key === expectedRaw ||
    (expectedHex && keyHex && keyHex === expectedHex);
  if (!key || !match) {
    console.log(
      "[Admin auth] Header present:",
      !!rawHeader || !!req.headers.authorization,
      "| Received length:",
      key?.length ?? 0,
      "| Expected length:",
      expectedRaw.length
    );
    return error(res, "Unauthorized. Use header X-Admin-Key: <your key> or Authorization: Bearer <your key>", 401);
  }
  next();
}
