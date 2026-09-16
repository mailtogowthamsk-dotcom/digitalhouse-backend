import type { Request, Response } from "express";
import { error, success } from "../utils/response";
import { rejectBenefitSchema } from "../validations/businessBenefit.validation";
import * as BenefitService from "../services/BusinessBenefit.service";

type AdminRequest = Request & { adminEmail?: string | null };

/** GET /api/admin/business-benefits/pending */
export async function listPending(req: AdminRequest, res: Response) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  try {
    const data = await BenefitService.adminListPending(page, limit, q);
    return success(res, data);
  } catch (e: any) {
    return error(res, e?.message ?? "Failed", e?.status ?? 400);
  }
}

/** POST /api/admin/business-benefits/:id/approve */
export async function approve(req: AdminRequest, res: Response) {
  const id = Number(req.params.id);
  if (!id) return error(res, "Invalid benefit", 400);
  try {
    const benefit = await BenefitService.adminApproveBenefit(id, req.adminEmail);
    return success(res, { benefit });
  } catch (e: any) {
    return error(res, e?.message ?? "Failed", e?.status ?? 400);
  }
}

/** POST /api/admin/business-benefits/:id/reject */
export async function reject(req: AdminRequest, res: Response) {
  const id = Number(req.params.id);
  if (!id) return error(res, "Invalid benefit", 400);
  const parsed = rejectBenefitSchema.safeParse(req.body);
  if (!parsed.success) return error(res, parsed.error.issues[0]?.message ?? "Invalid input", 400);
  try {
    const benefit = await BenefitService.adminRejectBenefit(
      id,
      parsed.data.remarks,
      req.adminEmail
    );
    return success(res, { benefit });
  } catch (e: any) {
    return error(res, e?.message ?? "Failed", e?.status ?? 400);
  }
}
