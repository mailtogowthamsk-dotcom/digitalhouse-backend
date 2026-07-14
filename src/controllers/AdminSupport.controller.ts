import type { Request, Response } from "express";
import { success, error } from "../utils/response";
import { supportService } from "../services/Support.service";
import {
  adminUpdateTicketSchema,
  adminFaqSchema,
  adminGuideSchema,
  adminContactConfigSchema
} from "../validations/support.validation";
import { User } from "../models";
import { ZodError } from "zod";

type AuthRequest = Request & { adminEmail?: string | null };

async function resolveAdminUserId(req: AuthRequest): Promise<number | null> {
  const email = req.adminEmail ?? (req as any).adminEmail;
  if (!email || typeof email !== "string") return null;
  const user = await User.findOne({
    where: { email },
    attributes: ["id"]
  });
  return user?.id ?? null;
}

function parseId(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function zodMessage(e: ZodError): string {
  return e.errors?.[0]?.message ?? "Invalid request";
}

function qStr(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

export async function listTickets(req: AuthRequest, res: Response) {
  const q = req.query ?? {};
  const data = await supportService.adminListTickets({
    status: qStr(q.status),
    type: qStr(q.type),
    category: qStr(q.category),
    priority: qStr(q.priority),
    q: qStr(q.q),
    page: qStr(q.page) ? Number(qStr(q.page)) : 1,
    limit: qStr(q.limit) ? Number(qStr(q.limit)) : 20
  });
  return success(res, data);
}

export async function getTicket(req: AuthRequest, res: Response) {
  const ticketId = parseId(req.params?.ticketId);
  if (ticketId == null) return error(res, "Invalid ticket id", 400);
  try {
    const ticket = await supportService.adminGetTicket(ticketId);
    return success(res, { ticket });
  } catch (e: any) {
    if (e?.status === 404) return error(res, e.message, 404);
    throw e;
  }
}

export async function updateTicket(req: AuthRequest, res: Response) {
  const ticketId = parseId(req.params?.ticketId);
  if (ticketId == null) return error(res, "Invalid ticket id", 400);
  try {
    const body = adminUpdateTicketSchema.parse(req.body);
    const adminUserId = await resolveAdminUserId(req);
    const ticket = await supportService.adminUpdateTicket(adminUserId, ticketId, body);
    return success(res, { ticket });
  } catch (e: any) {
    if (e instanceof ZodError) return error(res, zodMessage(e), 400);
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function listFaqs(_req: AuthRequest, res: Response) {
  const faqs = await supportService.adminListFaqs();
  return success(res, { faqs });
}

export async function createFaq(req: AuthRequest, res: Response) {
  try {
    const body = adminFaqSchema.parse(req.body);
    const faq = await supportService.adminUpsertFaq(null, body);
    return success(res, { faq }, 201);
  } catch (e: any) {
    if (e instanceof ZodError) return error(res, zodMessage(e), 400);
    throw e;
  }
}

export async function updateFaq(req: AuthRequest, res: Response) {
  const faqId = parseId(req.params?.faqId);
  if (faqId == null) return error(res, "Invalid faq id", 400);
  try {
    const body = adminFaqSchema.parse(req.body);
    const faq = await supportService.adminUpsertFaq(faqId, body);
    return success(res, { faq });
  } catch (e: any) {
    if (e instanceof ZodError) return error(res, zodMessage(e), 400);
    if (e?.status === 404) return error(res, e.message, 404);
    throw e;
  }
}

export async function deleteFaq(req: AuthRequest, res: Response) {
  const faqId = parseId(req.params?.faqId);
  if (faqId == null) return error(res, "Invalid faq id", 400);
  try {
    await supportService.adminDeleteFaq(faqId);
    return success(res, { ok: true });
  } catch (e: any) {
    if (e?.status === 404) return error(res, e.message, 404);
    throw e;
  }
}

export async function listGuides(_req: AuthRequest, res: Response) {
  const guides = await supportService.adminListGuides();
  return success(res, { guides });
}

export async function upsertGuide(req: AuthRequest, res: Response) {
  const guideId = parseId(req.params?.guideId);
  try {
    const body = adminGuideSchema.parse(req.body);
    const guide = await supportService.adminUpsertGuide(guideId, body);
    return success(res, { guide }, guideId ? 200 : 201);
  } catch (e: any) {
    if (e instanceof ZodError) return error(res, zodMessage(e), 400);
    if (e?.status === 404) return error(res, e.message, 404);
    throw e;
  }
}

export async function createGuide(req: AuthRequest, res: Response) {
  try {
    const body = adminGuideSchema.parse(req.body);
    const guide = await supportService.adminUpsertGuide(null, body);
    return success(res, { guide }, 201);
  } catch (e: any) {
    if (e instanceof ZodError) return error(res, zodMessage(e), 400);
    throw e;
  }
}

export async function deleteGuide(req: AuthRequest, res: Response) {
  const guideId = parseId(req.params?.guideId);
  if (guideId == null) return error(res, "Invalid guide id", 400);
  try {
    await supportService.adminDeleteGuide(guideId);
    return success(res, { ok: true });
  } catch (e: any) {
    if (e?.status === 404) return error(res, e.message, 404);
    throw e;
  }
}

export async function getContact(_req: AuthRequest, res: Response) {
  const contact = await supportService.adminGetContactConfig();
  return success(res, { contact });
}

export async function updateContact(req: AuthRequest, res: Response) {
  try {
    const body = adminContactConfigSchema.parse(req.body);
    const contact = await supportService.adminUpdateContactConfig(body);
    return success(res, { contact });
  } catch (e: any) {
    if (e instanceof ZodError) return error(res, zodMessage(e), 400);
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}
