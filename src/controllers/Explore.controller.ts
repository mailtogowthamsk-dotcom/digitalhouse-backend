import { Response } from "express";
import { exploreService } from "../services/Explore.service";
import { success, error } from "../utils/response";
import { validateExploreSearchQuery } from "../validations/explore.validation";
import type { User } from "../models";

type AuthRequest = {
  user?: User;
  query?: unknown;
};

export async function searchExplore(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const params = validateExploreSearchQuery(req.query);
  const data = await exploreService.searchExplore(req.user.id, params);
  return success(res, data);
}

export async function getExploreDiscovery(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const data = await exploreService.getExploreDiscovery(req.user.id);
  return success(res, data);
}
