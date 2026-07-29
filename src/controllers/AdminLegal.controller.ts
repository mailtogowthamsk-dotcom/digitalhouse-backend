import { Request, Response } from "express";
import { legalService } from "../services/Legal.service";
import { success, error } from "../utils/response";
import {
  createLegalDraftSchema,
  createLegalTypeSchema,
  publishLegalSchema,
  restoreLegalSchema,
  updateLegalDraftSchema,
  updateLegalTypeSchema
} from "../validations/legal.validation";

function adminEmail(req: Request): string {
  return (req as any).adminEmail || (req as any).admin?.email || "admin";
}

function statusOf(e: unknown): number {
  return typeof (e as any)?.status === "number" ? (e as any).status : 500;
}

function fail(res: Response, e: unknown, fallback = "Request failed") {
  const status = statusOf(e);
  return error(res, e instanceof Error ? e.message : fallback, status === 500 ? 400 : status);
}

export async function listSummary(_req: Request, res: Response) {
  const documents = await legalService.listDocumentsSummary();
  return success(res, { documents });
}

export async function listTypes(req: Request, res: Response) {
  const includeInactive = String(req.query.includeInactive || "") === "1";
  const types = await legalService.listTypes(includeInactive);
  return success(res, { types });
}

export async function createType(req: Request, res: Response) {
  try {
    const body = createLegalTypeSchema.parse(req.body);
    const type = await legalService.createType(body, adminEmail(req));
    return success(res, { type }, 201);
  } catch (e) {
    return fail(res, e);
  }
}

export async function updateType(req: Request, res: Response) {
  try {
    const body = updateLegalTypeSchema.parse(req.body);
    const type = await legalService.updateType(String(req.params.documentKey), body);
    return success(res, { type });
  } catch (e) {
    return fail(res, e);
  }
}

export async function getDocument(req: Request, res: Response) {
  try {
    const document = await legalService.getDocumentById(Number(req.params.id));
    return success(res, { document });
  } catch (e) {
    return fail(res, e);
  }
}

export async function getLatest(req: Request, res: Response) {
  try {
    const document = await legalService.getLatestDraft(String(req.params.documentKey));
    return success(res, { document });
  } catch (e) {
    return fail(res, e);
  }
}

export async function createDraft(req: Request, res: Response) {
  try {
    const body = createLegalDraftSchema.parse(req.body);
    const document = await legalService.createDraft(body, adminEmail(req));
    return success(res, { document }, 201);
  } catch (e) {
    return fail(res, e);
  }
}

export async function updateDraft(req: Request, res: Response) {
  try {
    const body = updateLegalDraftSchema.parse(req.body);
    const document = await legalService.updateDraft(Number(req.params.id), body, adminEmail(req));
    return success(res, { document });
  } catch (e) {
    return fail(res, e);
  }
}

export async function publish(req: Request, res: Response) {
  try {
    const body = publishLegalSchema.parse(req.body ?? {});
    const document = await legalService.publishDocument(
      String(req.params.documentKey),
      {
        bump: body.bump,
        changeSummary: body.changeSummary,
        documentId: req.body?.documentId ? Number(req.body.documentId) : undefined
      },
      adminEmail(req)
    );
    return success(res, { document });
  } catch (e) {
    return fail(res, e);
  }
}

export async function history(req: Request, res: Response) {
  try {
    const versions = await legalService.listHistory(String(req.params.documentKey));
    return success(res, { versions });
  } catch (e) {
    return fail(res, e);
  }
}

export async function compare(req: Request, res: Response) {
  try {
    const leftId = Number(req.query.leftId);
    const rightId = Number(req.query.rightId);
    if (!leftId || !rightId) return error(res, "leftId and rightId are required", 400);
    const result = await legalService.compareVersions(
      String(req.params.documentKey),
      leftId,
      rightId
    );
    return success(res, result);
  } catch (e) {
    return fail(res, e);
  }
}

export async function restore(req: Request, res: Response) {
  try {
    const body = restoreLegalSchema.parse(req.body);
    const document = await legalService.restoreVersion(
      String(req.params.documentKey),
      body.versionId,
      adminEmail(req)
    );
    return success(res, { document });
  } catch (e) {
    return fail(res, e);
  }
}
