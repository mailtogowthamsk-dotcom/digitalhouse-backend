import type { Request, Response } from "express";
import type { User } from "../models";
import { success, error } from "../utils/response";
import { usersDirectoryService } from "../services/UsersDirectory.service";
import { memberProfileService } from "../services/MemberProfile.service";
import { usernameService } from "../services/Username.service";
import { userService } from "../services/user.service";
import {
  validateUsersSearchQuery,
  validateUsernameBody,
  validateUsernameAvailabilityQuery,
  validateProfileVisibilityBody,
  validateConnectionRequestsBody,
  validateReportUserBody
} from "../validations/users.validation";
import * as MatrimonySafety from "../services/MatrimonySafety.service";

type AuthRequest = Request & { user?: User };

function handleServiceError(res: Response, e: unknown) {
  const err = e as { message?: string; status?: number };
  return error(res, err.message ?? "Request failed", err.status ?? 400);
}

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
  const users = await usersDirectoryService.searchMembers(req.user.id, q);
  return success(res, { users });
}

/** GET /api/users/username/availability?username= */
export async function checkUsernameAvailability(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const { username } = validateUsernameAvailabilityQuery(req.query);
  try {
    const available = await usernameService.isUsernameAvailable(username, req.user.id);
    return success(res, { available, username: usernameService.normalizeUsername(username) });
  } catch (e) {
    return handleServiceError(res, e);
  }
}

/** POST /api/users/username — first-time username assignment */
export async function setUsername(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const { username } = validateUsernameBody(req.body);
  try {
    const user = await usernameService.assignUsername(req.user.id, username);
    return success(res, { user: userService.toAuthUser(user) });
  } catch (e) {
    return handleServiceError(res, e);
  }
}

/** PUT /api/users/username — change username */
export async function changeUsername(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const { username } = validateUsernameBody(req.body);
  try {
    const user = await usernameService.changeUsername(req.user.id, username);
    const eligibility = await usernameService.getUsernameChangeEligibility(req.user.id);
    return success(res, { user: userService.toAuthUser(user), eligibility });
  } catch (e) {
    return handleServiceError(res, e);
  }
}

/** GET /api/users/username/eligibility */
export async function getUsernameEligibility(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const eligibility = await usernameService.getUsernameChangeEligibility(req.user.id);
  return success(res, { eligibility });
}

/** PATCH /api/users/me/visibility */
export async function updateVisibility(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const { profileVisibility } = validateProfileVisibilityBody(req.body);
  try {
    const data = await memberProfileService.updateProfileVisibility(req.user.id, profileVisibility);
    return success(res, data);
  } catch (e) {
    return handleServiceError(res, e);
  }
}

/** PATCH /api/users/me/connection-requests */
export async function updateConnectionRequests(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const { allowConnectionRequests } = validateConnectionRequestsBody(req.body);
  try {
    const data = await memberProfileService.updateAllowConnectionRequests(
      req.user.id,
      allowConnectionRequests
    );
    return success(res, data);
  } catch (e) {
    return handleServiceError(res, e);
  }
}

/** GET /api/users/me/blocks */
export async function listBlockedUsers(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const users = await memberProfileService.listBlockedMembers(req.user.id);
  return success(res, { users });
}

/** POST /api/users/:userId/block */
export async function blockUser(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const targetUserId = Number(req.params.userId);
  if (!targetUserId || targetUserId === req.user.id) return error(res, "Invalid member", 400);
  try {
    const data = await MatrimonySafety.blockUser(req.user.id, targetUserId);
    return success(res, data);
  } catch (e) {
    return handleServiceError(res, e);
  }
}

/** DELETE /api/users/:userId/block */
export async function unblockUser(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const targetUserId = Number(req.params.userId);
  if (!targetUserId || targetUserId === req.user.id) return error(res, "Invalid member", 400);
  try {
    await MatrimonySafety.unblockUser(req.user.id, targetUserId);
    return success(res, { unblocked: true });
  } catch (e) {
    return handleServiceError(res, e);
  }
}

/** POST /api/users/:userId/report */
export async function reportUser(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const targetUserId = Number(req.params.userId);
  if (!targetUserId || targetUserId === req.user.id) return error(res, "Invalid member", 400);
  const { reasonCode, details } = validateReportUserBody(req.body);
  try {
    const data = await MatrimonySafety.reportProfile(req.user.id, targetUserId, reasonCode, details);
    return success(res, data, 201);
  } catch (e) {
    return handleServiceError(res, e);
  }
}

/** GET /api/users/:identifier — member profile by @username or numeric id */
export async function getMemberProfile(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const identifier = String(req.params.identifier ?? "").trim();
  if (!identifier) return error(res, "Invalid member", 400);
  try {
    const profile = await memberProfileService.getMemberProfile(req.user.id, identifier);
    return success(res, { profile });
  } catch (e) {
    return handleServiceError(res, e);
  }
}

/** GET /api/users/:identifier/posts — member timeline (paginated) */
export async function getMemberPosts(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const identifier = String(req.params.identifier ?? "").trim();
  if (!identifier) return error(res, "Invalid member", 400);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  try {
    const data = await memberProfileService.getMemberPosts(
      req.user.id,
      identifier,
      limit,
      offset
    );
    return success(res, data);
  } catch (e) {
    return handleServiceError(res, e);
  }
}
