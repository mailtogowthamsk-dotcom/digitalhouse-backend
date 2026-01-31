import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt.util";
import { User } from "../models";
import { error } from "../utils/response";

export type AuthPayload = { userId: number };

/** Attach req.user if valid JWT; otherwise 401 */
export async function authMiddleware(req: Request & { user?: User }, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) return error(res, "Unauthorized", 401);

  try {
    const payload = verifyAccessToken(token) as AuthPayload;
    const user = await User.findByPk(payload.userId);
    if (!user) return error(res, "User not found", 401);
    if (user.status !== "APPROVED") return error(res, "Account not approved", 403);
    req.user = user;
    next();
  } catch {
    return error(res, "Invalid or expired token", 401);
  }
}
