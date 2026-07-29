import type { Request, Response } from "express";
import { z } from "zod";
import { error, success } from "../utils/response";
import * as AdminMarketplace from "../services/AdminMarketplace.service";
import { getAdminEmail } from "./AdminSettings.controller";

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z
    .enum([
      "pending",
      "changes",
      "live",
      "rejected",
      "sold",
      "hidden",
      "expired",
      "archived",
      "reported",
      "all"
    ])
    .default("pending"),
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(64).optional(),
  district: z.string().trim().max(255).optional(),
  intent: z.string().trim().max(32).optional(),
  condition: z.string().trim().max(32).optional(),
  featured: z.enum(["all", "featured", "not_featured"]).optional(),
  priceMin: z.coerce.number().int().min(0).optional(),
  priceMax: z.coerce.number().int().min(0).optional(),
  createdFrom: z.string().optional(),
  createdTo: z.string().optional()
});

const reasonSchema = z.object({
  reason: z.string().trim().min(3).max(2000)
});

const notesSchema = z.object({
  notes: z.string().trim().min(3).max(2000)
});

const hideSchema = z.object({
  reason: z.string().trim().min(3).max(2000).optional()
});

const noteSchema = z.object({
  note: z.string().trim().min(2).max(2000)
});

const updateSchema = z
  .object({
    title: z.string().trim().min(2).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    marketplaceCategory: z.string().trim().max(64).nullable().optional(),
    marketplaceCondition: z.string().trim().max(32).nullable().optional(),
    marketplaceDistrict: z.string().trim().max(255).nullable().optional(),
    marketplacePrice: z.coerce.number().int().min(0).nullable().optional(),
    marketplaceNegotiable: z.boolean().optional(),
    marketplaceAdminNote: z.string().trim().max(2000).nullable().optional()
  })
  .strict();

function parseId(req: Request): number | null {
  const id = Number(req.params.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function listMarketplace(req: Request, res: Response) {
  const query = listSchema.parse(req.query);
  const data = await AdminMarketplace.listAdminMarketplace(query);
  return success(res, data);
}

export async function getOverview(_req: Request, res: Response) {
  const data = await AdminMarketplace.getMarketplaceOverview();
  return success(res, data);
}

export async function getListing(req: Request, res: Response) {
  const id = parseId(req);
  if (!id) return error(res, "Invalid listing id", 400);
  try {
    const data = await AdminMarketplace.getAdminMarketplaceDetail(id);
    return success(res, data);
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function updateListing(req: Request, res: Response) {
  const id = parseId(req);
  if (!id) return error(res, "Invalid listing id", 400);
  try {
    const body = updateSchema.parse(req.body || {});
    const data = await AdminMarketplace.updateAdminMarketplaceListing(id, body, getAdminEmail(req));
    return success(res, { ...data, message: "Listing updated." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function addNote(req: Request, res: Response) {
  const id = parseId(req);
  if (!id) return error(res, "Invalid listing id", 400);
  try {
    const body = noteSchema.parse(req.body || {});
    const data = await AdminMarketplace.addAdminMarketplaceNote(id, body.note, getAdminEmail(req));
    return success(res, { ...data, message: "Note added." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function approveListing(req: Request, res: Response) {
  const id = parseId(req);
  if (!id) return error(res, "Invalid listing id", 400);
  try {
    const listing = await AdminMarketplace.approveAdminMarketplaceListing(id, getAdminEmail(req));
    return success(res, { listing, message: "Listing approved." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function rejectListing(req: Request, res: Response) {
  const id = parseId(req);
  if (!id) return error(res, "Invalid listing id", 400);
  try {
    const body = reasonSchema.parse(req.body || {});
    const listing = await AdminMarketplace.rejectAdminMarketplaceListing(
      id,
      body.reason,
      getAdminEmail(req)
    );
    return success(res, { listing, message: "Listing rejected." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function requestChanges(req: Request, res: Response) {
  const id = parseId(req);
  if (!id) return error(res, "Invalid listing id", 400);
  try {
    const body = notesSchema.parse(req.body || {});
    const listing = await AdminMarketplace.requestChangesAdminMarketplaceListing(
      id,
      body.notes,
      getAdminEmail(req)
    );
    return success(res, { listing, message: "Changes requested." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function hideListing(req: Request, res: Response) {
  const id = parseId(req);
  if (!id) return error(res, "Invalid listing id", 400);
  try {
    const body = hideSchema.parse(req.body || {});
    const listing = await AdminMarketplace.hideAdminMarketplaceListing(
      id,
      body.reason,
      getAdminEmail(req)
    );
    return success(res, { listing, message: "Listing hidden." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function unhideListing(req: Request, res: Response) {
  const id = parseId(req);
  if (!id) return error(res, "Invalid listing id", 400);
  try {
    const listing = await AdminMarketplace.unhideAdminMarketplaceListing(id, getAdminEmail(req));
    return success(res, { listing, message: "Listing restored." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function softDeleteListing(req: Request, res: Response) {
  const id = parseId(req);
  if (!id) return error(res, "Invalid listing id", 400);
  try {
    const body = hideSchema.parse(req.body || {});
    const listing = await AdminMarketplace.softDeleteAdminMarketplaceListing(
      id,
      body.reason,
      getAdminEmail(req)
    );
    return success(res, { listing, message: "Listing soft deleted." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function restoreSoftDeletedListing(req: Request, res: Response) {
  const id = parseId(req);
  if (!id) return error(res, "Invalid listing id", 400);
  try {
    const listing = await AdminMarketplace.restoreSoftDeletedAdminMarketplaceListing(
      id,
      getAdminEmail(req)
    );
    return success(res, { listing, message: "Listing restored to pending review." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function dismissReports(req: Request, res: Response) {
  const id = parseId(req);
  if (!id) return error(res, "Invalid listing id", 400);
  try {
    const listing = await AdminMarketplace.dismissReportsAdminMarketplace(id, getAdminEmail(req));
    return success(res, { listing, message: "Reports dismissed." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function deleteListing(req: Request, res: Response) {
  const id = parseId(req);
  if (!id) return error(res, "Invalid listing id", 400);
  try {
    await AdminMarketplace.deleteAdminMarketplaceListing(id, getAdminEmail(req));
    return success(res, { message: "Listing deleted." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function setFeatured(req: Request, res: Response) {
  const id = parseId(req);
  if (!id) return error(res, "Invalid listing id", 400);
  try {
    const body = z.object({ featured: z.boolean() }).parse(req.body || {});
    const listing = await AdminMarketplace.setFeaturedAdminMarketplaceListing(
      id,
      body.featured,
      getAdminEmail(req)
    );
    return success(res, {
      listing,
      message: body.featured ? "Listing featured." : "Feature removed."
    });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}
