import type { Response } from "express";
import { z } from "zod";
import { success, error } from "../utils/response";
import { masterDataService } from "../services/MasterData.service";
import { MDM_TYPE_CODES } from "../constants/masterData.constants";

type AdminRequest = {
  admin?: { id?: number };
  params?: { itemId?: string; typeCode?: string };
  query?: unknown;
  body?: unknown;
};

function adminId(req: AdminRequest): number | null {
  return req.admin?.id != null ? Number(req.admin.id) : null;
}

export async function listTypes(req: AdminRequest, res: Response) {
  const types = await masterDataService.listTypes();
  return success(res, { types });
}

export async function listItems(req: AdminRequest, res: Response) {
  const query = z
    .object({
      type: z.string().trim().min(1),
      parentId: z.coerce.number().int().positive().optional(),
      q: z.string().trim().max(120).optional(),
      active: z.enum(["all", "active", "inactive"]).default("all"),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      sort: z.enum(["label", "sort_order", "updated"]).default("sort_order")
    })
    .parse(req.query ?? {});

  const typeCode = query.type.toUpperCase();
  if (!MDM_TYPE_CODES.includes(typeCode as any)) {
    return error(res, "Unknown type", 400);
  }
  const data = await masterDataService.adminListItems({
    typeCode,
    parentId: query.parentId,
    q: query.q,
    active: query.active,
    page: query.page,
    limit: query.limit,
    sort: query.sort
  });
  return success(res, data);
}

export async function createItem(req: AdminRequest, res: Response) {
  const body = z
    .object({
      type_code: z.string().trim().min(1),
      label: z.string().trim().min(1).max(160),
      code: z.string().trim().max(64).nullable().optional(),
      parent_id: z.number().int().positive().nullable().optional(),
      sort_order: z.number().int().optional(),
      aliases: z.array(z.string().trim().max(160)).max(50).optional(),
      metadata: z.record(z.unknown()).nullable().optional(),
      is_active: z.boolean().optional()
    })
    .strict()
    .parse(req.body ?? {});

  try {
    const item = await masterDataService.adminCreateItem(adminId(req), {
      ...body,
      type_code: body.type_code.toUpperCase()
    });
    return success(res, { item }, 201);
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function updateItem(req: AdminRequest, res: Response) {
  const itemId = Number(req.params?.itemId);
  if (!itemId) return error(res, "Invalid item id", 400);
  const body = z
    .object({
      label: z.string().trim().min(1).max(160).optional(),
      code: z.string().trim().max(64).nullable().optional(),
      parent_id: z.number().int().positive().nullable().optional(),
      sort_order: z.number().int().optional(),
      aliases: z.array(z.string().trim().max(160)).max(50).nullable().optional(),
      metadata: z.record(z.unknown()).nullable().optional(),
      is_active: z.boolean().optional()
    })
    .strict()
    .parse(req.body ?? {});

  try {
    const item = await masterDataService.adminUpdateItem(adminId(req), itemId, body);
    return success(res, { item });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function listAudits(req: AdminRequest, res: Response) {
  const query = z
    .object({
      type: z.string().trim().optional(),
      itemId: z.coerce.number().int().positive().optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(30)
    })
    .parse(req.query ?? {});

  const data = await masterDataService.adminListAudits({
    typeCode: query.type?.toUpperCase(),
    itemId: query.itemId,
    page: query.page,
    limit: query.limit
  });
  return success(res, data);
}
