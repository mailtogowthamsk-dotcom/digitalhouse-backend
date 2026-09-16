import type { Request, Response } from "express";
import type { User } from "../models";
import { error, success } from "../utils/response";
import {
  benefitBodySchema,
  verifyClaimSchema
} from "../validations/businessBenefit.validation";
import * as BenefitService from "../services/BusinessBenefit.service";

type AuthRequest = Request & { user?: User };

function handleErr(res: Response, e: any) {
  return error(res, e?.message ?? "Request failed", e?.status ?? 400);
}

/** POST /api/business/benefits */
export async function createBenefit(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const parsed = benefitBodySchema.safeParse(req.body);
  if (!parsed.success) return error(res, parsed.error.issues[0]?.message ?? "Invalid input", 400);
  try {
    const benefit = await BenefitService.createBenefit(req.user.id, parsed.data as any);
    return success(res, { benefit }, 201);
  } catch (e: any) {
    return handleErr(res, e);
  }
}

/** GET /api/business/benefits/mine */
export async function listMine(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  try {
    const benefits = await BenefitService.listMyBenefits(req.user.id);
    return success(res, { benefits });
  } catch (e: any) {
    return handleErr(res, e);
  }
}

/** GET /api/business/benefits/available */
export async function listAvailable(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  try {
    const benefits = await BenefitService.listAvailableBenefits(req.user.id);
    return success(res, { benefits });
  } catch (e: any) {
    return handleErr(res, e);
  }
}

/** GET /api/business/benefits/owner/:userId — public benefits on a member profile */
export async function listForOwner(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const ownerId = Number(req.params.userId);
  if (!ownerId) return error(res, "Invalid user", 400);
  try {
    const benefits = await BenefitService.listPublicBenefitsForOwner(req.user.id, ownerId);
    return success(res, { benefits });
  } catch (e: any) {
    return handleErr(res, e);
  }
}

/** GET /api/business/benefits/claims/mine */
export async function listMyClaims(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  try {
    const claims = await BenefitService.listMyClaims(req.user.id);
    return success(res, { claims });
  } catch (e: any) {
    return handleErr(res, e);
  }
}

/** GET /api/business/benefits/claims/:claimId */
export async function getClaim(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const claimId = Number(req.params.claimId);
  if (!claimId) return error(res, "Invalid claim", 400);
  try {
    const claim = await BenefitService.getClaimForUser(req.user.id, claimId);
    return success(res, { claim });
  } catch (e: any) {
    return handleErr(res, e);
  }
}

/** POST /api/business/benefits/claims/lookup — preview only (does not mark used) */
export async function lookupClaim(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const parsed = verifyClaimSchema.safeParse(req.body);
  if (!parsed.success) return error(res, parsed.error.issues[0]?.message ?? "Invalid input", 400);
  try {
    const claim = await BenefitService.lookupClaimByCode(req.user.id, parsed.data.claimCode);
    return success(res, { claim });
  } catch (e: any) {
    return handleErr(res, e);
  }
}

/** POST /api/business/benefits/claims/mark-used — confirm redemption */
export async function markClaimUsed(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const parsed = verifyClaimSchema.safeParse(req.body);
  if (!parsed.success) return error(res, parsed.error.issues[0]?.message ?? "Invalid input", 400);
  try {
    const claim = await BenefitService.markClaimUsed(req.user.id, parsed.data.claimCode);
    return success(res, { claim });
  } catch (e: any) {
    return handleErr(res, e);
  }
}

/** POST /api/business/benefits/claims/verify — alias of lookup (preview only) */
export async function verifyClaim(req: AuthRequest, res: Response) {
  return lookupClaim(req, res);
}

/** GET /api/business/benefits/:id */
export async function getBenefit(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const id = Number(req.params.id);
  if (!id) return error(res, "Invalid benefit", 400);
  try {
    try {
      const owned = await BenefitService.getMyBenefit(req.user.id, id);
      return success(res, { benefit: owned, scope: "owner" });
    } catch (ownerErr: any) {
      if (ownerErr?.status !== 404) throw ownerErr;
    }
    const benefit = await BenefitService.getPublicBenefit(req.user.id, id);
    return success(res, { benefit, scope: "public" });
  } catch (e: any) {
    return handleErr(res, e);
  }
}

/** PUT /api/business/benefits/:id */
export async function updateBenefit(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const id = Number(req.params.id);
  if (!id) return error(res, "Invalid benefit", 400);
  const parsed = benefitBodySchema.safeParse(req.body);
  if (!parsed.success) return error(res, parsed.error.issues[0]?.message ?? "Invalid input", 400);
  try {
    const benefit = await BenefitService.updateBenefit(req.user.id, id, parsed.data as any);
    return success(res, { benefit });
  } catch (e: any) {
    return handleErr(res, e);
  }
}

/** PATCH /api/business/benefits/:id/disable */
export async function disableBenefit(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const id = Number(req.params.id);
  if (!id) return error(res, "Invalid benefit", 400);
  try {
    const benefit = await BenefitService.disableBenefit(req.user.id, id);
    return success(res, { benefit });
  } catch (e: any) {
    return handleErr(res, e);
  }
}

/** POST /api/business/benefits/:id/claim */
export async function claimBenefit(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const id = Number(req.params.id);
  if (!id) return error(res, "Invalid benefit", 400);
  try {
    const claim = await BenefitService.claimBenefit(req.user.id, id);
    return success(res, { claim }, 201);
  } catch (e: any) {
    return handleErr(res, e);
  }
}
