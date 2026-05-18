import type { Request, Response } from "express";
import { ZodError } from "zod";
import { success, error } from "../utils/response";
import {
  getMatrimonyHub,
  saveMatrimonyDraft,
  submitMatrimonyProfile
} from "../services/Matrimony.service";
import { validateMatrimonyDraftBody, validateMatrimonySubmitBody } from "../validations/matrimony.validation";
import { MATRIMONY_INCOME_RANGES, MATRIMONY_HEIGHT_OPTIONS, MATRIMONY_COMPLEXION_OPTIONS, PARTNER_GENDER_OPTIONS } from "../constants/matrimony.constants";
import { MATRIMONY_PROFILE_FOR } from "../constants/matrimony-photo.constants";
import * as Discover from "../services/MatrimonyDiscover.service";
import {
  discoverQuerySchema,
  sendInterestSchema,
  respondInterestSchema
} from "../validations/matrimony-discovery.validation";

export async function getMe(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const hub = await getMatrimonyHub(userId);
  return success(res, hub);
}

export async function saveDraft(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  try {
    const payload = validateMatrimonyDraftBody(req.body);
    const hub = await saveMatrimonyDraft(userId, payload);
    return success(res, hub);
  } catch (e: any) {
    if (e instanceof ZodError) return error(res, formatZodMessage(e), 400);
    throw e;
  }
}

function formatZodMessage(err: ZodError): string {
  const first = err.errors[0];
  if (!first) return "Invalid matrimony data";
  const path = first.path.length ? `${first.path.join(".")}: ` : "";
  return `${path}${first.message}`;
}

export async function submit(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  try {
    const payload = validateMatrimonySubmitBody(req.body);
    const hub = await submitMatrimonyProfile(userId, payload);
    return success(res, { ...hub, message: "Matrimony profile submitted for admin approval." });
  } catch (e: any) {
    if (e instanceof ZodError) return error(res, formatZodMessage(e), 400);
    if (e.status === 400) {
      return res.status(400).json({
        ok: false,
        message: e.message,
        ...(Array.isArray(e.missing) && e.missing.length ? { missing: e.missing } : {})
      });
    }
    throw e;
  }
}

export async function getFormOptions(_req: Request, res: Response) {
  return success(res, {
    income_ranges: MATRIMONY_INCOME_RANGES,
    heights: MATRIMONY_HEIGHT_OPTIONS,
    complexions: MATRIMONY_COMPLEXION_OPTIONS,
    partner_gender: PARTNER_GENDER_OPTIONS,
    profile_for: MATRIMONY_PROFILE_FOR
  });
}

export async function discover(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  try {
    const q = discoverQuerySchema.parse(req.query);
    const data = await Discover.discoverProfiles(userId, q);
    return success(res, data);
  } catch (e: any) {
    if (e instanceof ZodError) return error(res, formatZodMessage(e), 400);
    if (e.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function candidateDetail(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const candidateUserId = Number(req.params.userId);
  try {
    const data = await Discover.getCandidateDetail(userId, candidateUserId);
    return success(res, data);
  } catch (e: any) {
    if (e.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function sendInterest(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  try {
    const body = sendInterestSchema.parse(req.body);
    const data = await Discover.sendInterest(userId, body.toUserId, body.introMessage);
    return success(res, data);
  } catch (e: any) {
    if (e instanceof ZodError) return error(res, formatZodMessage(e), 400);
    if (e.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function respondInterest(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const interestId = Number(req.params.id);
  try {
    const { action } = respondInterestSchema.parse(req.body);
    const data = await Discover.respondToInterest(userId, interestId, action);
    return success(res, data);
  } catch (e: any) {
    if (e instanceof ZodError) return error(res, formatZodMessage(e), 400);
    if (e.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function listInterestsSent(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const items = await Discover.listInterests(userId, "sent");
  return success(res, { items });
}

export async function listInterestsReceived(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const items = await Discover.listInterests(userId, "received");
  return success(res, { items });
}

export async function listMatches(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const items = await Discover.listMatches(userId);
  return success(res, { items });
}

export async function getHoroscope(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const otherUserId = Number(req.params.userId);
  try {
    const data = await Discover.getHoroscopeForMatch(userId, otherUserId);
    return success(res, data);
  } catch (e: any) {
    if (e.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function revealContact(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const otherUserId = Number(req.params.userId);
  try {
    const data = await Discover.revealContactIfMatched(userId, otherUserId);
    return success(res, data);
  } catch (e: any) {
    if (e.status) return error(res, e.message, e.status);
    throw e;
  }
}
