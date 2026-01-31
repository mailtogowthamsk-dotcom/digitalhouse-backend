import { Request, Response } from "express";
import * as adminService from "../services/admin.service";
import { userService } from "../services/user.service";
import { success, error } from "../utils/response";
import { approveUserSchema, rejectUserSchema } from "../validations/admin.validation";

const ADMIN_ID = process.env.ADMIN_API_KEY || "admin";

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
  await adminService.approveUser(id, ADMIN_ID, body.remarks ?? null);
  return success(res, { message: "User approved." });
}

/** Reject user; remarks required (reason) */
export async function rejectUser(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!id) return error(res, "Invalid user id", 400);
  const body = rejectUserSchema.parse(req.body);
  await adminService.rejectUser(id, ADMIN_ID, body.remarks);
  return success(res, { message: "User rejected." });
}
