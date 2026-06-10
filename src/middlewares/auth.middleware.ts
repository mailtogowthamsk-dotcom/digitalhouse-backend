import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt.util";
import { User } from "../models";
import { error } from "../utils/response";

export type AuthPayload = { userId: number };

async function loadUserFromBearer(req: Request & { user?: User }, res: Response): Promise<User | null> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    error(res, "Unauthorized", 401);
    return null;
  }
  try {
    const payload = verifyAccessToken(token) as AuthPayload;
    const user = await User.findByPk(payload.userId);
    if (!user) {
      error(res, "User not found", 401);
      return null;
    }
    return user;
  } catch {
    error(res, "Invalid or expired token", 401);
    return null;
  }
}

/** JWT valid + user exists (any status). Used for profile completion & /me during setup. */
export async function jwtAuthMiddleware(
  req: Request & { user?: User },
  res: Response,
  next: NextFunction
) {
  const user = await loadUserFromBearer(req, res);
  if (!user) return;
  req.user = user;
  next();
}

/** Attach req.user if valid JWT; otherwise 401. Requires APPROVED status. */
export async function authMiddleware(req: Request & { user?: User }, res: Response, next: NextFunction) {
  const user = await loadUserFromBearer(req, res);
  if (!user) return;
  if (user.status !== "APPROVED") return error(res, "Account not approved", 403);
  req.user = user;
  next();
}
