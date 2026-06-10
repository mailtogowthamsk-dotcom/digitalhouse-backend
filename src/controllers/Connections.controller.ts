import type { Request, Response } from "express";
import type { User } from "../models";
import { success, error } from "../utils/response";
import { connectionService } from "../services/Connection.service";

type AuthRequest = Request & { user?: User };

function handleServiceError(res: Response, e: unknown) {
  const err = e as { message?: string; status?: number; code?: string };
  return error(res, err.message ?? "Request failed", err.status ?? 400);
}

function parseUserId(raw: string): number | null {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** GET /api/connections/requests */
export async function listRequests(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const requests = await connectionService.listIncomingRequests(req.user.id);
  return success(res, { requests });
}

/** GET /api/connections */
export async function listConnections(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const connections = await connectionService.listConnections(req.user.id);
  return success(res, { connections });
}

/** GET /api/connections/requests/count */
export async function requestCount(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const count = await connectionService.getIncomingRequestCount(req.user.id);
  return success(res, { count });
}

/** POST /api/connections/:userId/request */
export async function sendRequest(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const targetId = parseUserId(String(req.params.userId ?? ""));
  if (!targetId) return error(res, "Invalid member", 400);
  try {
    const data = await connectionService.sendRequest(req.user.id, targetId);
    return success(res, data);
  } catch (e) {
    return handleServiceError(res, e);
  }
}

/** POST /api/connections/:userId/accept */
export async function acceptRequest(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const requesterId = parseUserId(String(req.params.userId ?? ""));
  if (!requesterId) return error(res, "Invalid member", 400);
  try {
    const data = await connectionService.acceptRequest(req.user.id, requesterId);
    return success(res, data);
  } catch (e) {
    return handleServiceError(res, e);
  }
}

/** POST /api/connections/:userId/reject */
export async function rejectRequest(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const requesterId = parseUserId(String(req.params.userId ?? ""));
  if (!requesterId) return error(res, "Invalid member", 400);
  try {
    const data = await connectionService.rejectRequest(req.user.id, requesterId);
    return success(res, data);
  } catch (e) {
    return handleServiceError(res, e);
  }
}

/** POST /api/connections/:userId/cancel */
export async function cancelRequest(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const recipientId = parseUserId(String(req.params.userId ?? ""));
  if (!recipientId) return error(res, "Invalid member", 400);
  try {
    const data = await connectionService.cancelRequest(req.user.id, recipientId);
    return success(res, data);
  } catch (e) {
    return handleServiceError(res, e);
  }
}

/** POST /api/connections/:userId/disconnect */
export async function disconnect(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const otherId = parseUserId(String(req.params.userId ?? ""));
  if (!otherId) return error(res, "Invalid member", 400);
  try {
    const data = await connectionService.disconnect(req.user.id, otherId);
    return success(res, data);
  } catch (e) {
    return handleServiceError(res, e);
  }
}
