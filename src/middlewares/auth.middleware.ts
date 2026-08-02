import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt.util";
import { isAccessTokenActive } from "../utils/tokenRevocation";
import { User } from "../models";
import { error } from "../utils/response";
import { logSecurityEvent } from "../utils/securityLog";

export type AuthPayload = { userId: number; iat?: number };

/** Enough for APPROVED / DELETED gate — used on almost every API call. */
const AUTH_GATE_ATTRIBUTES = ["id", "status"] as const;

/**
 * Fields needed by /auth/me, linked-accounts, and registration correction paths.
 * Do not use this for high-frequency feed/analytics routes.
 */
const AUTH_SESSION_ATTRIBUTES = [
  "id",
  "fullName",
  "email",
  "mobile",
  "username",
  "status",
  "community",
  "kulam",
  "profilePhoto",
  "profileComplete",
  "profileVisibility",
  "allowConnectionRequests",
  "signupProvider",
  "emailVerified",
  "registrationRequestedFields",
  "pendingMobile",
  "pendingProfilePhoto",
  "registrationAdminRemarks",
  "linkedProviders",
  "googleId",
  "createdAt"
] as const;

type AuthAttrMode = "gate" | "session";

/** Short TTL cache for gate lookups — cuts remote RTT on bursty analytics / feed actions. */
const GATE_CACHE_TTL_MS = Math.max(
  5_000,
  Number(process.env.AUTH_GATE_CACHE_TTL_MS || 20_000)
);
const gateUserCache = new Map<number, { user: User; expiresAt: number }>();

function readGateCache(userId: number): User | null {
  const hit = gateUserCache.get(userId);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    gateUserCache.delete(userId);
    return null;
  }
  return hit.user;
}

function writeGateCache(user: User): void {
  gateUserCache.set(user.id, { user, expiresAt: Date.now() + GATE_CACHE_TTL_MS });
}

/** Drop cached gate row (call after status changes if in-process). */
export function invalidateAuthGateCache(userId: number): void {
  gateUserCache.delete(userId);
}

async function loadUserFromBearer(
  req: Request & { user?: User },
  res: Response,
  mode: AuthAttrMode
): Promise<User | null> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    error(res, "Unauthorized", 401);
    return null;
  }
  try {
    const payload = verifyAccessToken(token) as AuthPayload;
    if (!(await isAccessTokenActive(payload.userId, payload.iat))) {
      logSecurityEvent("jwt_invalid", { kind: "member", reason: "revoked", userId: payload.userId });
      error(res, "Invalid or expired token", 401);
      return null;
    }

    if (mode === "gate") {
      const cached = readGateCache(payload.userId);
      if (cached) {
        if (cached.status === "DELETED") {
          error(res, "Unauthorized", 401);
          return null;
        }
        return cached;
      }
    }

    const user = await User.findByPk(payload.userId, {
      attributes: [...(mode === "gate" ? AUTH_GATE_ATTRIBUTES : AUTH_SESSION_ATTRIBUTES)]
    });
    if (!user) {
      error(res, "User not found", 401);
      return null;
    }
    // Soft-deleted accounts cannot use any JWT-authenticated route
    if (user.status === "DELETED") {
      error(res, "Unauthorized", 401);
      return null;
    }
    if (mode === "gate") writeGateCache(user);
    return user;
  } catch {
    error(res, "Invalid or expired token", 401);
    return null;
  }
}

/** JWT valid + user exists (registration /me / legal). Rejects DELETED. */
export async function jwtAuthMiddleware(
  req: Request & { user?: User },
  res: Response,
  next: NextFunction
) {
  const user = await loadUserFromBearer(req, res, "session");
  if (!user) return;
  req.user = user;
  next();
}

/** Attach req.user if valid JWT; otherwise 401. Requires APPROVED status. */
export async function authMiddleware(req: Request & { user?: User }, res: Response, next: NextFunction) {
  const user = await loadUserFromBearer(req, res, "gate");
  if (!user) return;
  if (user.status !== "APPROVED") return error(res, "Account not approved", 403);
  req.user = user;
  next();
}

/**
 * Media uploads during registration (Google incomplete profile / correction).
 * APPROVED users always allowed; review-path users may upload profile media only.
 */
export async function registrationMediaAuthMiddleware(
  req: Request & { user?: User },
  res: Response,
  next: NextFunction
) {
  const user = await loadUserFromBearer(req, res, "session");
  if (!user) return;
  if (user.status === "APPROVED") {
    req.user = user;
    return next();
  }
  // Registration path: waiting review, corrections, or incomplete Google profile
  if (
    user.status === "CHANGES_REQUESTED" ||
    user.status === "PENDING" ||
    user.status === "PENDING_REVIEW"
  ) {
    req.user = user;
    return next();
  }
  return error(res, "Account not approved", 403);
}

/** Attach req.user when Bearer token is present; never fail the request. */
export async function optionalAuth(
  req: Request & { user?: User },
  _res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token) as AuthPayload;
    const cached = readGateCache(payload.userId);
    if (cached) {
      if (cached.status === "APPROVED") req.user = cached;
      return next();
    }
    const user = await User.findByPk(payload.userId, {
      attributes: [...AUTH_GATE_ATTRIBUTES]
    });
    if (user && user.status === "APPROVED") {
      writeGateCache(user);
      req.user = user;
    }
  } catch {
    /* ignore invalid token for optional auth */
  }
  next();
}
