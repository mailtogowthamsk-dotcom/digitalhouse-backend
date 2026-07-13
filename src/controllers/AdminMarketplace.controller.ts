import type { Request, Response } from "express";
import { z } from "zod";
import { error, success } from "../utils/response";
import * as AdminMarketplace from "../services/AdminMarketplace.service";

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
  q: z.string().trim().max(120).optional()
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

export async function listMarketplace(req: Request, res: Response) {
  const query = listSchema.parse(req.query);
  const data = await AdminMarketplace.listAdminMarketplace(query);
  return success(res, data);
}

export async function approveListing(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid listing id", 400);
  try {
    const listing = await AdminMarketplace.approveAdminMarketplaceListing(id);
    return success(res, { listing, message: "Listing approved." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function rejectListing(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid listing id", 400);
  try {
    const body = reasonSchema.parse(req.body || {});
    const listing = await AdminMarketplace.rejectAdminMarketplaceListing(id, body.reason);
    return success(res, { listing, message: "Listing rejected." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function requestChanges(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid listing id", 400);
  try {
    const body = notesSchema.parse(req.body || {});
    const listing = await AdminMarketplace.requestChangesAdminMarketplaceListing(id, body.notes);
    return success(res, { listing, message: "Changes requested." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function hideListing(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid listing id", 400);
  try {
    const body = hideSchema.parse(req.body || {});
    const listing = await AdminMarketplace.hideAdminMarketplaceListing(id, body.reason);
    return success(res, { listing, message: "Listing hidden." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function unhideListing(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid listing id", 400);
  try {
    const listing = await AdminMarketplace.unhideAdminMarketplaceListing(id);
    return success(res, { listing, message: "Listing restored." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function dismissReports(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid listing id", 400);
  try {
    const listing = await AdminMarketplace.dismissReportsAdminMarketplace(id);
    return success(res, { listing, message: "Reports dismissed." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function deleteListing(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid listing id", 400);
  try {
    await AdminMarketplace.deleteAdminMarketplaceListing(id);
    return success(res, { message: "Listing deleted." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function setFeatured(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid listing id", 400);
  try {
    const body = z.object({ featured: z.boolean() }).parse(req.body || {});
    const listing = await AdminMarketplace.setFeaturedAdminMarketplaceListing(id, body.featured);
    return success(res, {
      listing,
      message: body.featured ? "Listing featured." : "Feature removed."
    });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}
