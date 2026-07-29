import { Request, Response } from "express";
import { legalService } from "../services/Legal.service";
import { success, error } from "../utils/response";
import { acceptLegalSchema } from "../validations/legal.validation";
import type { LegalAcceptanceSource } from "../constants/legal.constants";

function statusOf(e: unknown): number {
  return typeof (e as any)?.status === "number" ? (e as any).status : 500;
}

/** GET /legal — published catalog for settings menus. */
export async function listCatalog(_req: Request, res: Response) {
  const documents = await legalService.listPublishedCatalog();
  return success(res, { documents });
}

/** GET /legal/:slugOrKey — published document body. */
export async function getPublished(req: Request, res: Response) {
  try {
    const key = String(req.params.slugOrKey || req.params[0] || "").replace(/^\//, "");
    const result = await legalService.getPublished(key);
    return success(res, result);
  } catch (e: unknown) {
    return error(res, e instanceof Error ? e.message : "Not found", statusOf(e));
  }
}

/** Convenience aliases matching the product API list. */
export async function getByAlias(req: Request, res: Response) {
  try {
    const parts = req.path.split("/").filter(Boolean);
    const key = parts[parts.length - 1] || "";
    const result = await legalService.getPublished(key);
    return success(res, result);
  } catch (e: unknown) {
    return error(res, e instanceof Error ? e.message : "Not found", statusOf(e));
  }
}

/** GET /legal/status — auth required. */
export async function getStatus(req: Request & { user?: { id: number } }, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const status = await legalService.getAcceptanceStatus(req.user.id);
  return success(res, status);
}

/** POST /legal/accept — auth required. */
export async function accept(req: Request & { user?: { id: number } }, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  try {
    const body = acceptLegalSchema.parse(req.body);
    const keys = body.documentKeys?.length
      ? body.documentKeys
      : body.documentKey
        ? [body.documentKey]
        : [];
    const result = await legalService.acceptDocuments({
      userId: req.user.id,
      documentKeys: keys,
      source: (body.source as LegalAcceptanceSource) || "reacceptance",
      ipAddress: legalService.clientIp(req as any),
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null
    });
    return success(res, result);
  } catch (e: unknown) {
    const status = statusOf(e);
    return error(res, e instanceof Error ? e.message : "Could not record acceptance", status === 500 ? 400 : status);
  }
}
