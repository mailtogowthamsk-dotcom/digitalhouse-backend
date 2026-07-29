import type { Request, Response } from "express";
import { z } from "zod";
import { error, success } from "../utils/response";
import * as AdminRoles from "../services/AdminRoles.service";
import * as AdminUsers from "../services/AdminUsers.service";
import { ADMIN_ROLES, type AdminRole } from "../constants/adminRoles.constants";
import {
  getAdminEmail,
  getAdminRole,
  resolveActorForRoleManagement,
  requireAdminAction,
  requireAdminModule,
  requireAdminRoles
} from "../middlewares/adminPermission.middleware";

/** Re-export guards so existing imports from this controller keep working. */
export {
  getAdminEmail,
  getAdminRole,
  requireAdminAction,
  requireAdminModule,
  requireAdminRoles
};

export async function getSettings(req: Request, res: Response) {
  const data = await AdminRoles.getSettingsOverview(getAdminEmail(req));
  return success(res, data);
}

export async function getMe(req: Request, res: Response) {
  const session = AdminRoles.getSessionPermissions(getAdminEmail(req));
  return success(res, { admin: session });
}

const setRoleSchema = z
  .object({
    email: z.string().email(),
    role: z.enum(ADMIN_ROLES as unknown as [string, ...string[]])
  })
  .strict();

export async function setAdminRole(req: Request, res: Response) {
  const actor = resolveActorForRoleManagement(req);
  if (!actor) {
    return error(
      res,
      "Admin login required to change roles (or set ADMIN_API_KEY_ALLOW_ROLE_MANAGEMENT=true).",
      403
    );
  }
  const body = setRoleSchema.parse(req.body ?? {});
  try {
    const result = await AdminRoles.setAdminRole(body.email, body.role as AdminRole, actor);
    return success(res, {
      admin: { email: result.email, role: result.role },
      previousRole: result.previousRole,
      changed: result.changed,
      message: result.changed
        ? `Role updated to ${result.role}.`
        : `Role unchanged (${result.role}).`,
      overview: await AdminRoles.getSettingsOverview(getAdminEmail(req))
    });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

const createAdminSchema = z
  .object({
    name: z.string().min(2).max(120),
    email: z.string().email(),
    password: z.string().min(8).max(128),
    role: z.enum(ADMIN_ROLES as unknown as [string, ...string[]]).default("ADMIN")
  })
  .strict();

export async function createAdminUser(req: Request, res: Response) {
  const actor = resolveActorForRoleManagement(req);
  if (!actor) {
    return error(
      res,
      "Admin login required to create admins (or set ADMIN_API_KEY_ALLOW_ROLE_MANAGEMENT=true).",
      403
    );
  }
  const body = createAdminSchema.parse(req.body ?? {});
  try {
    const admin = await AdminUsers.createAdminUser({
      name: body.name,
      email: body.email,
      password: body.password,
      role: body.role as AdminRole,
      actorEmail: actor
    });
    try {
      const { recordConfigChange } = await import("../services/PlatformConfigAudit.service");
      await recordConfigChange({
        action: "ADMIN_USER_CREATED",
        auditModule: "settings",
        settingModule: "settings",
        setting: admin.email,
        oldValue: null,
        newValue: admin.role,
        changedBy: actor,
        meta: { adminUser: admin.email, role: admin.role, name: admin.name }
      });
    } catch {
      /* non-fatal */
    }
    return success(
      res,
      {
        admin,
        message: `Admin ${admin.email} created.`,
        overview: await AdminRoles.getSettingsOverview(getAdminEmail(req))
      },
      201
    );
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

const updateAdminSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    role: z.enum(ADMIN_ROLES as unknown as [string, ...string[]]).optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(8).max(128).optional()
  })
  .strict();

export async function updateAdminUser(req: Request, res: Response) {
  const actor = resolveActorForRoleManagement(req);
  if (!actor) {
    return error(
      res,
      "Admin login required to update admins (or set ADMIN_API_KEY_ALLOW_ROLE_MANAGEMENT=true).",
      403
    );
  }
  const email = String(req.params.email || "")
    .trim()
    .toLowerCase();
  if (!email) return error(res, "Email required.", 400);
  const body = updateAdminSchema.parse(req.body ?? {});
  try {
    if (body.role) {
      await AdminRoles.setAdminRole(email, body.role as AdminRole, actor);
    }
    const admin = await AdminUsers.updateAdminUser(
      email,
      {
        name: body.name,
        role: body.role as AdminRole | undefined,
        isActive: body.isActive,
        password: body.password
      },
      actor
    );
    return success(res, {
      admin,
      message: `Admin ${admin.email} updated.`,
      overview: await AdminRoles.getSettingsOverview(getAdminEmail(req))
    });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}
