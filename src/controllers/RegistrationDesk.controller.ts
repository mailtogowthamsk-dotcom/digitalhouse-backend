import { Request, Response } from "express";
import { ZodError } from "zod";
import { z } from "zod";
import { success, error } from "../utils/response";
import { getAdminEmail, getAdminRole } from "../middlewares/adminPermission.middleware";
import * as SupportTeam from "../services/registrationDesk/SupportTeam.service";
import * as Queue from "../services/registrationDesk/RegistrationQueue.service";

const memberBody = z.object({
  name: z.string().trim().max(120).nullable().optional(),
  email: z.string().trim().email().max(191),
  isActive: z.boolean().optional()
});

const reassignBody = z.object({
  memberId: z.number().int().positive()
});

const noteBody = z.object({
  body: z.string().trim().min(1).max(2000)
});

function actor(req: Request): { email: string; role: ReturnType<typeof getAdminRole> } {
  const email = getAdminEmail(req);
  if (!email) {
    throw Object.assign(new Error("Admin login is required for this action."), { status: 403 });
  }
  return { email, role: getAdminRole(req) };
}

function sendError(res: Response, err: unknown) {
  if (err instanceof ZodError) {
    return error(res, err.errors[0]?.message ?? "Invalid request", 400);
  }
  const status = (err as { status?: number })?.status;
  const message = err instanceof Error ? err.message : "Request failed";
  return error(res, message, status && status >= 400 && status < 600 ? status : 400);
}

export async function listMembers(_req: Request, res: Response) {
  const items = await SupportTeam.listSupportMembers();
  return success(res, { items });
}

export async function createMember(req: Request, res: Response) {
  try {
    const body = memberBody.parse(req.body || {});
    const item = await SupportTeam.addSupportMember({
      name: body.name,
      email: body.email,
      actorEmail: actor(req).email
    });
    return success(res, { item }, 201);
  } catch (err) {
    return sendError(res, err);
  }
}

export async function patchMember(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid member.", 400);
    const body = memberBody.partial().parse(req.body || {});
    const item = await SupportTeam.updateSupportMember(id, body, actor(req).email);
    return success(res, { item });
  } catch (err) {
    return sendError(res, err);
  }
}

export async function removeMember(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid member.", 400);
    await SupportTeam.removeSupportMember(id, actor(req).email);
    return success(res, { removed: true });
  } catch (err) {
    return sendError(res, err);
  }
}

const FILTERS = ["all", "new", "unassigned", "assigned", "in_progress", "approved", "rejected"] as const;

export async function summary(_req: Request, res: Response) {
  const stats = await Queue.registrationSummary();
  return success(res, { stats });
}

export async function listRequests(req: Request, res: Response) {
  const filterRaw = String(req.query.filter || "all");
  const filter = (FILTERS as readonly string[]).includes(filterRaw)
    ? (filterRaw as Queue.QueueFilter)
    : "all";
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 20);
  const sort = req.query.sort === "updated" ? "updated" : "submitted";
  const dir = req.query.dir === "asc" ? "asc" : "desc";
  const scope = String(req.query.scope || "");
  let mineEmail: string | null = null;
  if (scope === "mine") mineEmail = actor(req).email;
  const data = await Queue.listRegistrationRequests({
    filter,
    q: typeof req.query.q === "string" ? req.query.q : "",
    page: Number.isFinite(page) ? page : 1,
    limit: Number.isFinite(limit) ? limit : 20,
    sort,
    dir,
    mineEmail
  });
  return success(res, data);
}

export async function getRequest(req: Request, res: Response) {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId) || userId <= 0) return error(res, "Invalid request.", 400);
    const data = await Queue.getRegistrationRequest(userId, actor(req));
    return success(res, data);
  } catch (err) {
    return sendError(res, err);
  }
}

export async function claimRequest(req: Request, res: Response) {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId) || userId <= 0) return error(res, "Invalid request.", 400);
    await Queue.claimRegistrationRequest(userId, actor(req));
    return success(res, { claimed: true });
  } catch (err) {
    return sendError(res, err);
  }
}

export async function reassignRequest(req: Request, res: Response) {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId) || userId <= 0) return error(res, "Invalid request.", 400);
    const body = reassignBody.parse(req.body || {});
    await Queue.reassignRegistrationRequest(userId, body.memberId, actor(req));
    return success(res, { reassigned: true });
  } catch (err) {
    return sendError(res, err);
  }
}

export async function startRequest(req: Request, res: Response) {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId) || userId <= 0) return error(res, "Invalid request.", 400);
    await Queue.startRegistrationReview(userId, actor(req));
    return success(res, { started: true });
  } catch (err) {
    return sendError(res, err);
  }
}

export async function addNote(req: Request, res: Response) {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId) || userId <= 0) return error(res, "Invalid request.", 400);
    const body = noteBody.parse(req.body || {});
    await Queue.addRegistrationNote(userId, body.body, actor(req));
    return success(res, { saved: true });
  } catch (err) {
    return sendError(res, err);
  }
}
