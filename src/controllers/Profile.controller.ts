import { Request, Response } from "express";
import { profileService } from "../services/Profile.service";
import { success, error } from "../utils/response";
import { validateProfileActivityQuery, validateUpdateProfileBody } from "../validations/profile.validation";
import type { User } from "../models";

type AuthRequest = Request & { user?: User };

/**
 * GET /api/profile/me
 * Fetch logged-in user's profile: id, name, profile_image, verified, member_since,
 * personal_info (masked mobile/email, gender, dob, blood_group, city, district),
 * professional_info, stats. JWT + admin approved required.
 */
export async function getProfile(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const data = await profileService.getProfile(req.user.id);
  return success(res, data);
}

/**
 * PUT /api/profile/me
 * Update editable fields only (profile_image, address, professional info, skills).
 * On update sets status to PENDING_REVIEW; admin must re-approve.
 */
export async function updateProfile(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const body = validateUpdateProfileBody(req.body);
  const data = await profileService.updateProfile(req.user.id, body);
  return success(res, data);
}

/**
 * GET /api/profile/stats
 * Community stats: total posts, jobs, marketplace, helping hand, joined communities.
 */
export async function getStats(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const data = await profileService.getProfileStats(req.user.id);
  return success(res, data);
}

/**
 * GET /api/profile/activity?tab=my|saved|liked&page=1&limit=20
 * My Posts, Saved Posts, or Liked Posts (paginated).
 */
export async function getActivity(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const query = validateProfileActivityQuery(req.query);
  const data = await profileService.getProfileActivity(
    req.user.id,
    query.tab,
    query.page,
    query.limit
  );
  return success(res, data);
}
