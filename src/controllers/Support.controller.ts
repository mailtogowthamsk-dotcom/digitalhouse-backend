import type { Request, Response } from "express";
import { success, error } from "../utils/response";
import { supportService } from "../services/Support.service";
import {
  createSupportTicketSchema,
  supportTicketReplySchema
} from "../validations/support.validation";
import type { User } from "../models";
import { ZodError } from "zod";

type AuthRequest = Request & { user?: User };

function parseId(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function zodMessage(e: ZodError): string {
  return e.errors?.[0]?.message ?? "Invalid request";
}

export async function getHome(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const data = await supportService.getSupportHome(req.user.id);
  return success(res, data);
}

export async function listFaqs(_req: AuthRequest, res: Response) {
  const faqs = await supportService.listFaqs();
  return success(res, { faqs });
}

export async function listGuides(_req: AuthRequest, res: Response) {
  const guides = await supportService.listGuides();
  return success(res, { guides });
}

export async function getGuide(req: AuthRequest, res: Response) {
  const guideId = parseId(req.params?.guideId);
  if (guideId == null) return error(res, "Invalid guide id", 400);
  try {
    const guide = await supportService.getGuide(guideId);
    return success(res, { guide });
  } catch (e: any) {
    if (e?.status === 404) return error(res, e.message, 404);
    throw e;
  }
}

export async function getContact(_req: AuthRequest, res: Response) {
  const contact = await supportService.getContactConfig();
  return success(res, { contact });
}

export async function createTicket(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  try {
    const body = createSupportTicketSchema.parse(req.body);
    const ticket = await supportService.createTicket(req.user.id, body);
    return success(res, { ticket }, 201);
  } catch (e: any) {
    if (e instanceof ZodError) return error(res, zodMessage(e), 400);
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function listMyTickets(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const tickets = await supportService.listMyTickets(req.user.id);
  return success(res, { tickets });
}

export async function getMyTicket(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const ticketId = parseId(req.params?.ticketId);
  if (ticketId == null) return error(res, "Invalid ticket id", 400);
  try {
    const ticket = await supportService.getMyTicket(req.user.id, ticketId);
    return success(res, { ticket });
  } catch (e: any) {
    if (e?.status === 404) return error(res, e.message, 404);
    throw e;
  }
}

export async function replyTicket(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const ticketId = parseId(req.params?.ticketId);
  if (ticketId == null) return error(res, "Invalid ticket id", 400);
  try {
    const body = supportTicketReplySchema.parse(req.body);
    const ticket = await supportService.replyAsUser(req.user.id, ticketId, body.body);
    return success(res, { ticket });
  } catch (e: any) {
    if (e instanceof ZodError) return error(res, zodMessage(e), 400);
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}
