import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { error, success } from "../utils/response";
import * as AdminRoles from "../services/AdminRoles.service";
import {
  ADMIN_ROLES,
  roleHasAction,
  roleHasModule,
  type AdminAction,
  type AdminModule,
  type AdminRole
} from "../constants/adminRoles.constants";

export function getAdminEmail(req: Request): string | null {
  const email = (req as any).adminEmail;
  return typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;
}

export function getAdminRole(req: Request): AdminRole {
  const fromReq = (req as any).adminRole as AdminRole | undefined;
  if (fromReq) return fromReq;
  return AdminRoles.resolveAdminRole(getAdminEmail(req));
}

/** Require one of the given roles (after adminMiddleware). */
export function requireAdminRoles(...allowed: AdminRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = getAdminRole(req);
    if (!allowed.includes(role)) {
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

export async function getSettings(req: Request, res: Response) {
  const data = AdminRoles.getSettingsOverview(getAdminEmail(req));
  return success(res, data);
}

export async function getMe(req: Request, res: Response) {
  const email = getAdminEmail(req);
  const role = getAdminRole(req);
  return success(res, {
    admin: {
      email,
      role,
      roleLabel: AdminRoles.getSettingsOverview(email).me.roleLabel,
      modules: AdminRoles.getPermissionMatrix().modules
        .filter((m) => m.access[role])
        .map((m) => m.code),
      actions: AdminRoles.getPermissionMatrix().actions
        .filter((a) => a.access[role])
        .map((a) => a.code)
    }
  });
}

const setRoleSchema = z
  .object({
    email: z.string().email(),
    role: z.enum(ADMIN_ROLES as unknown as [string, ...string[]])
  })
  .strict();

export async function setAdminRole(req: Request, res: Response) {
  const actor = getAdminEmail(req);
  if (!actor) return error(res, "Admin email required to change roles.", 400);
  const body = setRoleSchema.parse(req.body ?? {});
  try {
    const result = AdminRoles.setAdminRole(body.email, body.role as AdminRole, actor);
    return success(res, {
      admin: result,
      message: `Role updated to ${result.role}.`,
      overview: AdminRoles.getSettingsOverview(actor)
    });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}
