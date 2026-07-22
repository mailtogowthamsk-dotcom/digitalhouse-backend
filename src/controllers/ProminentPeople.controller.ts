import { Request, Response } from "express";
import { success, error } from "../utils/response";
import { prominentPeopleService } from "../services/ProminentPeople.service";
import {
  prominentListQuerySchema,
  prominentAdminListQuerySchema,
  prominentPersonWriteSchema,
  prominentPersonUpdateSchema,
  prominentUploadUrlSchema,
  prominentUploadProxySchema,
  prominentBoolBodySchema
} from "../validations/prominentPeople.validation";

function adminEmail(req: Request): string {
  return (req as any).adminEmail || (req as any).admin?.email || "admin";
}

function parseFlag(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  return v === "1" || v === "true";
}

/** GET /api/prominent-people/categories */
export async function listCategories(_req: Request, res: Response) {
  const categories = await prominentPeopleService.listCategories(true);
  return success(res, { categories });
}

/** GET /api/prominent-people/featured */
export async function listFeatured(req: Request, res: Response) {
  const limit = Number(req.query.limit) || 8;
  const items = await prominentPeopleService.listFeatured(limit);
  return success(res, { items });
}

/** GET /api/prominent-people */
export async function listPeople(req: Request, res: Response) {
  const q = prominentListQuerySchema.parse(req.query);
  const data = await prominentPeopleService.listPeople({
    q: q.q,
    categoryCode: q.category,
    categoryId: q.categoryId,
    sort: q.sort,
    page: q.page,
    limit: q.limit,
    publishedOnly: true,
    featuredOnly: parseFlag(q.featured) === true ? true : undefined
  });
  return success(res, data);
}

/** GET /api/prominent-people/:id */
export async function getPerson(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 1) return error(res, "Invalid id", 400);
  try {
    const person = await prominentPeopleService.getPersonById(id, { publishedOnly: true });
    return success(res, { person });
  } catch (e: any) {
    return error(res, e?.message ?? "Not found", e?.status ?? 404);
  }
}

/** Admin list */
export async function adminList(req: Request, res: Response) {
  const q = prominentAdminListQuerySchema.parse(req.query);
  const data = await prominentPeopleService.adminListPeople({
    q: q.q,
    categoryId: q.categoryId,
    sort: q.sort,
    page: q.page,
    limit: q.limit,
    published: parseFlag(q.published),
    featured: parseFlag(q.featured)
  });
  return success(res, data);
}

export async function adminGet(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 1) return error(res, "Invalid id", 400);
  try {
    const person = await prominentPeopleService.getPersonById(id, { publishedOnly: false });
    return success(res, { person });
  } catch (e: any) {
    return error(res, e?.message ?? "Not found", e?.status ?? 404);
  }
}

export async function adminCreate(req: Request, res: Response) {
  const body = prominentPersonWriteSchema.parse(req.body);
  try {
    const person = await prominentPeopleService.createPerson(body, adminEmail(req));
    return success(res, { person }, 201);
  } catch (e: any) {
    return error(res, e?.message ?? "Failed to create", e?.status ?? 400);
  }
}

export async function adminUpdate(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 1) return error(res, "Invalid id", 400);
  const body = prominentPersonUpdateSchema.parse(req.body);
  try {
    const person = await prominentPeopleService.updatePerson(id, body, adminEmail(req));
    return success(res, { person });
  } catch (e: any) {
    return error(res, e?.message ?? "Failed to update", e?.status ?? 400);
  }
}

export async function adminDelete(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 1) return error(res, "Invalid id", 400);
  try {
    await prominentPeopleService.deletePerson(id);
    return success(res, { ok: true });
  } catch (e: any) {
    return error(res, e?.message ?? "Failed to delete", e?.status ?? 400);
  }
}

export async function adminSetPublished(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = prominentBoolBodySchema.parse(req.body);
  try {
    const person = await prominentPeopleService.setPublished(id, body.value, adminEmail(req));
    return success(res, { person });
  } catch (e: any) {
    return error(res, e?.message ?? "Failed", e?.status ?? 400);
  }
}

export async function adminSetFeatured(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = prominentBoolBodySchema.parse(req.body);
  try {
    const person = await prominentPeopleService.setFeatured(id, body.value, adminEmail(req));
    return success(res, { person });
  } catch (e: any) {
    return error(res, e?.message ?? "Failed", e?.status ?? 400);
  }
}

export async function adminUploadUrl(req: Request, res: Response) {
  const body = prominentUploadUrlSchema.parse(req.body);
  try {
    const data = await prominentPeopleService.generateProminentUploadUrl(
      body.kind,
      body.fileName,
      body.fileType
    );
    return success(res, data, 201);
  } catch (e: any) {
    return error(res, e?.message ?? "Upload URL failed", e?.status ?? 400);
  }
}

/** POST /api/admin/prominent-people/upload — proxy binary via base64 (avoids R2 CORS). */
export async function adminUploadProxy(req: Request, res: Response) {
  const body = prominentUploadProxySchema.parse(req.body);
  try {
    const data = await prominentPeopleService.uploadProminentImageBuffer(body);
    return success(res, data, 201);
  } catch (e: any) {
    return error(res, e?.message ?? "Upload failed", e?.status ?? 400);
  }
}

export async function adminCategories(_req: Request, res: Response) {
  const categories = await prominentPeopleService.listCategories(false);
  return success(res, { categories });
}
