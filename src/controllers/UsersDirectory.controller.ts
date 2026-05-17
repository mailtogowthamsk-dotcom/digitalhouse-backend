import type { Request, Response } from "express";
import type { User } from "../models";
import { success, error } from "../utils/response";
import { usersDirectoryService } from "../services/UsersDirectory.service";
import { validateUsersSearchQuery } from "../validations/users.validation";

type AuthRequest = Request & { user?: User };

/** GET /api/users */
export async function listUsers(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const users = await usersDirectoryService.listAllExceptMe(req.user.id);
  return success(res, { users });
}

/** GET /api/users/search?q= */
export async function searchUsers(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const { q } = validateUsersSearchQuery(req.query);
  const users = await usersDirectoryService.searchByName(req.user.id, q);
  return success(res, { users });
}

