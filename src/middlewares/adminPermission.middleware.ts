/**
 * Admin permission guards — shared helpers for routes.
 * Reuses AdminRoles.resolveAdminRole + catalog roleHas* (no duplicate RBAC).
 */
import type { Request, Response, NextFunction } from "express";
import { error } from "../utils/response";
import * as AdminRoles from "../services/AdminRoles.service";
import {
  roleHasAction,
  roleHasModule,
  type AdminAction,
  type AdminModule,
  type AdminRole
} from "../constants/adminRoles.constants";

const REQ_ROLE_KEY = "_resolvedAdminRole";

export function getAdminEmail(req: Request): string | null {
  const email = (req as any).adminEmail;
  return typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;
}

/** JWT email, or "api_key" when role-management override is enabled. */
export function resolveActorForRoleManagement(req: Request): string | null {
  const email = getAdminEmail(req);
  if (email) return email;
  if (
    (req as any).adminAuthMethod === "api_key" &&
    AdminRoles.apiKeyAllowsRoleManagement()
  ) {
    return "api_key";
  }
  return null;
}

/**
 * Live role resolve (admin_users cache / whitelist / API key role).
 * Memoized once per request when module + action guards both run.
 */
export function getAdminRole(req: Request): AdminRole {
  const cached = (req as any)[REQ_ROLE_KEY];
  if (cached) return cached as AdminRole;
  const role = AdminRoles.resolveAdminRole(getAdminEmail(req));
  (req as any)[REQ_ROLE_KEY] = role;
  return role;
}

/** Require one of the given roles (after adminMiddleware). */
export function requireAdminRoles(...allowed: AdminRole[]) {
  const allowedSet = new Set(allowed);
  return (req: Request, res: Response, next: NextFunction) => {
    const role = getAdminRole(req);
    if (!allowedSet.has(role)) {
      return error(res, "Insufficient permissions for this action.", 403);
    }
    return next();
  };
}

export function requireAdminAction(action: AdminAction) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = getAdminRole(req);
    if (!roleHasAction(role, action)) {
      return error(res, "Insufficient permissions for this action.", 403);
    }
    if (AdminRoles.isApiKeyRestrictedAction(action)) {
      const viaApiKey = (req as any).adminAuthMethod === "api_key" || !getAdminEmail(req);
      if (viaApiKey && !AdminRoles.apiKeyAllowsRoleManagement()) {
        return error(
          res,
          "This action requires an admin login session. API key cannot manage roles (set ADMIN_API_KEY_ALLOW_ROLE_MANAGEMENT=true to override).",
          403
        );
      }
    }
    return next();
  };
}

export function requireAdminModule(module: AdminModule) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = getAdminRole(req);
    if (!roleHasModule(role, module)) {
      return error(res, "Insufficient permissions for this module.", 403);
    }
    return next();
  };
}
