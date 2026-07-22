import type { Request, Response } from "express";
import { z } from "zod";
import { error, success } from "../utils/response";
import * as AdminHelpingHands from "../services/AdminHelpingHands.service";
import {
  HELP_CATEGORIES,
  HELP_STATUSES,
  type HelpStatus
} from "../constants/helpingHands.constants";

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z
    .enum(["open", "in_progress", "completed", "cancelled", "expired", "all"])
    .default("all"),
  category: z.enum(HELP_CATEGORIES as unknown as [string, ...string[]]).optional(),
  q: z.string().trim().max(120).optional()
});

const statusBodySchema = z
  .object({
    status: z.enum(HELP_STATUSES as unknown as [string, ...string[]])
  })
  .strict();

export async function listHelpRequests(req: Request, res: Response) {
  const query = listSchema.parse(req.query);
  const data = await AdminHelpingHands.listAdminHelpRequests(query);
  return success(res, data);
}

export async function getHelpRequest(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid request id", 400);
  try {
    const request = await AdminHelpingHands.getAdminHelpRequest(id);
    return success(res, { request });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function setHelpStatus(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid request id", 400);
  const body = statusBodySchema.parse(req.body ?? {});
  try {
    const request = await AdminHelpingHands.setAdminHelpStatus(id, body.status as HelpStatus);
    return success(res, { request, message: `Status set to ${body.status}.` });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function cancelHelpRequest(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid request id", 400);
  try {
    const request = await AdminHelpingHands.setAdminHelpStatus(id, "CANCELLED");
    return success(res, { request, message: "Request cancelled / frozen." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function reopenHelpRequest(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid request id", 400);
  try {
    const request = await AdminHelpingHands.setAdminHelpStatus(id, "OPEN");
    return success(res, { request, message: "Request reopened." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function completeHelpRequest(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid request id", 400);
  try {
    const request = await AdminHelpingHands.setAdminHelpStatus(id, "COMPLETED");
    return success(res, { request, message: "Request marked completed." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function expireHelpRequest(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid request id", 400);
  try {
    const request = await AdminHelpingHands.expireAdminHelpRequest(id);
    return success(res, { request, message: "Request expired." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function extendHelpRequest(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid request id", 400);
  try {
    const request = await AdminHelpingHands.extendAdminHelpRequest(id);
    return success(res, { request, message: "Request duration extended." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function deleteHelpRequest(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid request id", 400);
  try {
    await AdminHelpingHands.deleteAdminHelpRequest(id);
    return success(res, { message: "Help request deleted." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}
