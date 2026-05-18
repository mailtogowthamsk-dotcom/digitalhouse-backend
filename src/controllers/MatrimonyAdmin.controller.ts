import { Request, Response } from "express";
import * as matrimonyAdmin from "../services/MatrimonyAdmin.service";
import { success, error } from "../utils/response";
import {
  matrimonyListQuerySchema,
  assignReviewerSchema,
  approveMatrimonySchema,
  rejectMatrimonySchema,
  requestChangesSchema,
  suspendMatrimonySchema,
  addNoteSchema,
  verificationSchema,
  bulkMatrimonySchema
} from "../validations/matrimony-admin.validation";
import { MATRIMONY_CHANGE_REQUEST_TEMPLATES } from "../constants/matrimony-admin.constants";
import { MATRIMONY_CHANGE_SECTIONS } from "../constants/matrimony-changes.constants";

function adminEmail(req: Request): string {
  return (req as any).adminEmail ?? "admin";
}

export async function getStats(_req: Request, res: Response) {
  const stats = await matrimonyAdmin.getMatrimonyAdminStats();
  return success(res, stats);
}

export async function listRequests(req: Request, res: Response) {
  const query = matrimonyListQuerySchema.parse(req.query);
  const data = await matrimonyAdmin.listMatrimonyRequests(query);
  return success(res, data);
}

export async function getRequestDetail(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return error(res, "Invalid request id", 400);
  try {
    const data = await matrimonyAdmin.getMatrimonyRequestDetail(id);
    return success(res, data);
  } catch (e: any) {
    if (e.status === 404) return error(res, "Request not found", 404);
    throw e;
  }
}

export async function assignReviewer(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = assignReviewerSchema.parse(req.body);
  try {
    await matrimonyAdmin.assignReviewer(id, body.reviewerEmail, adminEmail(req));
    return success(res, { message: "Reviewer assigned." });
  } catch (e: any) {
    if (e.status === 404) return error(res, "Request not found", 404);
    throw e;
  }
}

export async function approveRequest(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = approveMatrimonySchema.parse(req.body ?? {});
  try {
    await matrimonyAdmin.approveMatrimonyRequest(id, adminEmail(req), body.remarks ?? undefined);
    return success(res, { message: "Matrimony profile approved." });
  } catch (e: any) {
    if (e.message === "Pending update not found") return error(res, "Request not found", 404);
    if (e.message === "Update is not pending") return error(res, "Request is not pending", 400);
    throw e;
  }
}

export async function rejectRequest(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = rejectMatrimonySchema.parse(req.body);
  try {
    await matrimonyAdmin.rejectMatrimonyRequest(
      id,
      adminEmail(req),
      body.reasonCode,
      body.comment ?? ""
    );
    return success(res, { message: "Matrimony profile rejected." });
  } catch (e: any) {
    if (e.message === "Pending update not found") return error(res, "Request not found", 404);
    if (e.message === "Update is not pending") return error(res, "Request is not pending", 400);
    throw e;
  }
}

export async function requestChanges(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = requestChangesSchema.parse(req.body);
  try {
    await matrimonyAdmin.requestMatrimonyChanges(
      id,
      adminEmail(req),
      body.comment,
      body.sections ?? []
    );
    return success(res, { message: "Changes requested from user." });
  } catch (e: any) {
    if (e.message === "Pending update not found") return error(res, "Request not found", 404);
    if (e.message === "Update is not pending") return error(res, "Request is not pending", 400);
    throw e;
  }
}

export async function suspendProfile(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = suspendMatrimonySchema.parse(req.body);
  try {
    await matrimonyAdmin.suspendMatrimonyProfile(id, adminEmail(req), body.reason);
    return success(res, { message: "Profile suspended." });
  } catch (e: any) {
    if (e.status === 404) return error(res, "Request not found", 404);
    throw e;
  }
}

export async function updateVerification(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = verificationSchema.parse(req.body);
  try {
    const verification = await matrimonyAdmin.updateVerification(
      id,
      adminEmail(req),
      body.key as any,
      body.checked
    );
    return success(res, { verification });
  } catch (e: any) {
    if (e.status === 404) return error(res, "Request not found", 404);
    throw e;
  }
}

export async function addNote(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = addNoteSchema.parse(req.body);
  try {
    const note = await matrimonyAdmin.addNote(id, adminEmail(req), body.content, body.noteType);
    return success(res, { note }, 201);
  } catch (e: any) {
    if (e.status === 404) return error(res, "Request not found", 404);
    throw e;
  }
}

export async function bulkAction(req: Request, res: Response) {
  const body = bulkMatrimonySchema.parse(req.body);
  const results = await matrimonyAdmin.bulkMatrimonyAction(
    body.updateIds,
    body.action,
    adminEmail(req),
    body.rejectReason,
    body.rejectComment
  );
  return success(res, { results });
}

export async function getConfig(_req: Request, res: Response) {
  return success(res, {
    changeRequestTemplates: MATRIMONY_CHANGE_REQUEST_TEMPLATES,
    changeSections: Object.entries(MATRIMONY_CHANGE_SECTIONS).map(([key, v]) => ({
      key,
      label: v.label,
      fields: v.fields
    }))
  });
}
