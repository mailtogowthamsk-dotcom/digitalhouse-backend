import { Request, Response } from "express";
import { ZodError } from "zod";
import * as adminService from "../services/admin.service";
import * as adminUserManagement from "../services/AdminUserManagement.service";
import { mediaService } from "../services/Media.service";
import { userService } from "../services/user.service";
import { success, error } from "../utils/response";
import {
  adminLoginSchema,
  approveUserSchema,
  rejectUserSchema,
  requestRegistrationChangesSchema,
  approveProfileUpdateSchema,
  rejectProfileUpdateSchema,
  updateAdminUserSchema,
  softDeleteUserSchema,
  hardDeleteUserSchema
} from "../validations/admin.validation";
import { adminBroadcastSchema } from "../validations/notifications.validation";
import { adminBroadcast, getNotificationAudienceStats } from "../services/Notification.service";

/** Attribution for API-key requests — never embed the raw key in audit fields. */
const ADMIN_API_KEY_ACTOR = "api_key";

/** POST /api/admin/login – email + password; returns JWT. No auth middleware. */
export async function login(req: Request, res: Response) {
  try {
    const body = adminLoginSchema.parse(req.body);
    const result = await adminService.adminLogin(body.email, body.password);
    return success(res, result);
  } catch (e: any) {
    if (e?.status === 429) return error(res, e.message || "Too many failed attempts. Try again later.", 429);
    if (e?.status === 401) return error(res, "Invalid credentials", 401);
    throw e;
  }
}

/** GET /admin/users – list all users (paginated) for User Management */
export async function listUsers(req: Request, res: Response) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const loginSource =
    typeof req.query.loginSource === "string" ? req.query.loginSource : undefined;
  const community = typeof req.query.community === "string" ? req.query.community : undefined;
  const gender = typeof req.query.gender === "string" ? req.query.gender : undefined;
  const sortBy = typeof req.query.sortBy === "string" ? req.query.sortBy : undefined;
  const sortDir =
    req.query.sortDir === "asc" || req.query.sortDir === "desc"
      ? req.query.sortDir
      : undefined;
  const result = await adminService.listUsers(page, limit, status, q, loginSource, {
    community,
    gender,
    sortBy,
    sortDir
  });
  return success(res, result);
}

/** GET /admin/notifications/stats – audience & push reach */
export async function notificationStats(req: Request, res: Response) {
  const stats = await getNotificationAudienceStats();
  return success(res, stats);
}

/** List pending users (awaiting approval) — paginated, same `{ users }` shape + optional meta. */
export async function listPending(req: Request, res: Response) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const { users, total } = await adminService.listPendingUsers({ limit, offset });
  const list = users.map((u) => userService.toAdminUser(u));
  return success(res, { users: list, page, limit, total });
}

/** Get full user profile by id */
export async function getUser(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!id) return error(res, "Invalid user id", 400);
  const detail = await adminUserManagement.getAdminUserDetail(id);
  if (!detail) return error(res, "User not found", 404);
  return success(res, detail);
}

/** PATCH /admin/users/:id – edit profile fields */
export async function updateUser(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!id) return error(res, "Invalid user id", 400);
  try {
    const body = updateAdminUserSchema.parse(req.body || {});
    const user = await adminUserManagement.updateAdminUser(id, body);
    return success(res, { user: userService.toAdminUser(user), message: "User updated." });
  } catch (e: any) {
    if (e instanceof ZodError) return error(res, e.errors[0]?.message ?? "Invalid request", 400);
    return error(res, e?.message ?? "Failed to update", e?.status ?? 400);
  }
}

/** POST /admin/users/:id/soft-delete */
export async function softDeleteUser(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!id) return error(res, "Invalid user id", 400);
  const body = softDeleteUserSchema.parse(req.body || {});
  const adminId = (req as any).adminEmail ?? ADMIN_API_KEY_ACTOR;
  try {
    const user = await adminUserManagement.softDeleteUser(id, adminId, body.reason);
    return success(res, { message: "User soft-deleted.", user: userService.toAdminUser(user) });
  } catch (e: any) {
    return error(res, e?.message ?? "Failed to soft-delete", e?.status ?? 400);
  }
}

/** POST /admin/users/:id/restore */
export async function restoreUser(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!id) return error(res, "Invalid user id", 400);
  const adminId = (req as any).adminEmail ?? ADMIN_API_KEY_ACTOR;
  try {
    const user = await adminUserManagement.restoreSoftDeletedUser(id, adminId);
    return success(res, { message: "User restored.", user: userService.toAdminUser(user) });
  } catch (e: any) {
    return error(res, e?.message ?? "Failed to restore", e?.status ?? 400);
  }
}

/** POST /admin/users/:id/hard-delete — irreversible; deletes DB + R2 */
export async function hardDeleteUser(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!id) return error(res, "Invalid user id", 400);
  const body = hardDeleteUserSchema.parse(req.body || {});
  const adminId = (req as any).adminEmail ?? ADMIN_API_KEY_ACTOR;
  try {
    const result = await adminUserManagement.hardDeleteUser(id, adminId, body.reason);
    return success(res, {
      message: "User permanently deleted including media.",
      ...result
    });
  } catch (e: any) {
    if (e instanceof ZodError) return error(res, e.errors[0]?.message ?? "Invalid request", 400);
    return error(res, e?.message ?? "Failed to hard-delete", e?.status ?? 400);
  }
}

/** Approve user; optional remarks */
export async function approveUser(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!id) return error(res, "Invalid user id", 400);
  const body = approveUserSchema.parse(req.body || {});
  const adminId = (req as any).adminEmail ?? ADMIN_API_KEY_ACTOR;
  try {
    await adminService.approveUser(id, adminId, body.remarks ?? null);
    return success(res, { message: "User approved." });
  } catch (e: any) {
    return error(res, e?.message ?? "Failed to approve", e?.status ?? 400);
  }
}

/** Reject user; remarks required (reason) */
export async function rejectUser(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!id) return error(res, "Invalid user id", 400);
  const body = rejectUserSchema.parse(req.body);
  const adminId = (req as any).adminEmail ?? ADMIN_API_KEY_ACTOR;
  try {
    await adminService.rejectUser(id, adminId, body.remarks);
    return success(res, { message: "User rejected." });
  } catch (e: any) {
    return error(res, e?.message ?? "Failed to reject", e?.status ?? 400);
  }
}

/** Request registration corrections (mobile / profile photo). */
export async function requestRegistrationChanges(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!id) return error(res, "Invalid user id", 400);
  const body = requestRegistrationChangesSchema.parse(req.body);
  const adminId = (req as any).adminEmail ?? ADMIN_API_KEY_ACTOR;
  try {
    await adminService.requestRegistrationChanges(id, adminId, body.remarks, body.requestedFields);
    return success(res, { message: "Changes requested." });
  } catch (e: any) {
    return error(res, e?.message ?? "Failed to request changes", e?.status ?? 400);
  }
}

/** List pending media (awaiting admin approval) */
export async function listPendingMedia(req: Request, res: Response) {
  const list = await mediaService.listPendingMedia();
  return success(res, { media: list });
}

/** Approve media (status → APPROVED) */
export async function approveMedia(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!id) return error(res, "Invalid media id", 400);
  try {
    await mediaService.approveMedia(id);
    return success(res, { message: "Media approved." });
  } catch (e: any) {
    if (e.message === "Media not found") return error(res, "Media not found", 404);
    if (e.message === "Media is not pending") return error(res, "Media is not pending", 400);
    throw e;
  }
}

/** Reject media (status → REJECTED) */
export async function rejectMedia(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!id) return error(res, "Invalid media id", 400);
  try {
    await mediaService.rejectMedia(id);
    return success(res, { message: "Media rejected." });
  } catch (e: any) {
    if (e.message === "Media not found") return error(res, "Media not found", 404);
    if (e.message === "Media is not pending") return error(res, "Media is not pending", 400);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Pending profile updates (Matrimony / Business)
// ---------------------------------------------------------------------------

/** GET /admin/stats – dashboard summary */
export async function getStats(req: Request, res: Response) {
  const stats = await adminService.getDashboardStats();
  return success(res, stats);
}

/** GET /admin/pending-updates – list pending Matrimony & Business profile updates */
export async function listPendingUpdates(req: Request, res: Response) {
  const sectionRaw = typeof req.query.section === "string" ? req.query.section.toUpperCase() : undefined;
  const section =
    sectionRaw === "MATRIMONY" || sectionRaw === "BUSINESS" ? sectionRaw : undefined;
  const page = req.query.page != null ? Math.max(1, Number(req.query.page) || 1) : undefined;
  const limit = req.query.limit != null ? Math.min(100, Math.max(1, Number(req.query.limit) || 20)) : undefined;
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const result = await adminService.listPendingProfileUpdates({
    section,
    page,
    limit,
    q
  });
  return success(res, {
    updates: result.updates,
    total: result.total,
    page: result.page,
    limit: result.limit
  });
}

/** POST /admin/approve-update – approve pending profile update; move data to main profile */
export async function approveUpdate(req: Request, res: Response) {
  const body = approveProfileUpdateSchema.parse(req.body || {});
  const adminId = (req as any).adminEmail ?? ADMIN_API_KEY_ACTOR;
  try {
    await adminService.approveProfileUpdate(body.updateId, adminId, body.remarks ?? null);
    return success(res, { message: "Profile update approved." });
  } catch (e: any) {
    if (e.message === "Pending update not found") return error(res, "Pending update not found", 404);
    if (e.message === "Update is not pending") return error(res, "Update is not pending", 400);
    throw e;
  }
}

/** POST /admin/notifications/broadcast – community / targeted announcements */
export async function broadcastNotifications(req: Request, res: Response) {
  try {
    const body = adminBroadcastSchema.parse(req.body);
    const result = await adminBroadcast({
      title: body.title,
      body: body.body,
      category: body.category as import("../constants/notification.constants").NotificationCategory | undefined,
      userIds: body.userIds,
      actionType: body.actionType as import("../constants/notification.constants").NotificationActionType | undefined,
      actionTargetId: body.actionTargetId,
      persistInApp: body.persistInApp
    });
    return success(res, result);
  } catch (e: any) {
    if (e instanceof ZodError) {
      return error(res, e.errors[0]?.message ?? "Invalid request", 400);
    }
    const status = e?.status === 400 ? 400 : 500;
    const message = e?.message ?? "Broadcast failed";
    if (status === 500) console.error("[admin broadcast]", e);
    return error(res, message, status);
  }
}

/** POST /admin/reject-update – reject pending profile update; store remarks */
export async function rejectUpdate(req: Request, res: Response) {
  const body = rejectProfileUpdateSchema.parse(req.body);
  const adminId = (req as any).adminEmail ?? ADMIN_API_KEY_ACTOR;
  try {
    await adminService.rejectProfileUpdate(body.updateId, adminId, body.remarks);
    return success(res, { message: "Profile update rejected." });
  } catch (e: any) {
    if (e.message === "Pending update not found") return error(res, "Pending update not found", 404);
    if (e.message === "Update is not pending") return error(res, "Update is not pending", 400);
    throw e;
  }
}
