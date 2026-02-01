import { Request, Response } from "express";
import * as adminService from "../services/admin.service";
import { mediaService } from "../services/Media.service";
import { userService } from "../services/user.service";
import { success, error } from "../utils/response";
import {
  adminLoginSchema,
  approveUserSchema,
  rejectUserSchema,
  approveProfileUpdateSchema,
  rejectProfileUpdateSchema
} from "../validations/admin.validation";

const ADMIN_ID = process.env.ADMIN_API_KEY || "admin";

/** POST /api/admin/login – email + password; returns JWT. No auth middleware. */
export async function login(req: Request, res: Response) {
  const body = adminLoginSchema.parse(req.body);
  try {
    const result = await adminService.adminLogin(body.email, body.password);
    return success(res, result);
  } catch (e: any) {
    if (e.status === 401) return error(res, "Invalid credentials", 401);
    throw e;
  }
}

/** GET /admin/users – list all users (paginated) for User Management */
export async function listUsers(req: Request, res: Response) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const result = await adminService.listUsers(page, limit, status);
  return success(res, result);
}

/** List pending users (awaiting approval) */
export async function listPending(req: Request, res: Response) {
  const users = await adminService.listPendingUsers();
  const list = users.map((u) => userService.toAdminUser(u));
  return success(res, { users: list });
}

/** Get full user profile by id */
export async function getUser(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!id) return error(res, "Invalid user id", 400);
  const user = await adminService.getUserById(id);
  if (!user) return error(res, "User not found", 404);
  const history = await adminService.getVerificationHistory(user.id);
  return success(res, {
    user: userService.toAdminUser(user),
    verificationHistory: history
  });
}

/** Approve user; optional remarks */
export async function approveUser(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!id) return error(res, "Invalid user id", 400);
  const body = approveUserSchema.parse(req.body || {});
  const adminId = (req as any).adminEmail ?? ADMIN_ID;
  await adminService.approveUser(id, adminId, body.remarks ?? null);
  return success(res, { message: "User approved." });
}

/** Reject user; remarks required (reason) */
export async function rejectUser(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!id) return error(res, "Invalid user id", 400);
  const body = rejectUserSchema.parse(req.body);
  const adminId = (req as any).adminEmail ?? ADMIN_ID;
  await adminService.rejectUser(id, adminId, body.remarks);
  return success(res, { message: "User rejected." });
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
  const list = await adminService.listPendingProfileUpdates();
  return success(res, { updates: list });
}

/** POST /admin/approve-update – approve pending profile update; move data to main profile */
export async function approveUpdate(req: Request, res: Response) {
  const body = approveProfileUpdateSchema.parse(req.body || {});
  const adminId = (req as any).adminEmail ?? ADMIN_ID;
  try {
    await adminService.approveProfileUpdate(body.updateId, adminId, body.remarks ?? null);
    return success(res, { message: "Profile update approved." });
  } catch (e: any) {
    if (e.message === "Pending update not found") return error(res, "Pending update not found", 404);
    if (e.message === "Update is not pending") return error(res, "Update is not pending", 400);
    throw e;
  }
}

/** POST /admin/reject-update – reject pending profile update; store remarks */
export async function rejectUpdate(req: Request, res: Response) {
  const body = rejectProfileUpdateSchema.parse(req.body);
  const adminId = (req as any).adminEmail ?? ADMIN_ID;
  try {
    await adminService.rejectProfileUpdate(body.updateId, adminId, body.remarks);
    return success(res, { message: "Profile update rejected." });
  } catch (e: any) {
    if (e.message === "Pending update not found") return error(res, "Pending update not found", 404);
    if (e.message === "Update is not pending") return error(res, "Update is not pending", 400);
    throw e;
  }
}
