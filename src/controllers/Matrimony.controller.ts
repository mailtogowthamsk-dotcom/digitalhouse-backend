import type { Request, Response } from "express";
import { ZodError } from "zod";
import { success, error } from "../utils/response";
import {
  getMatrimonyHub,
  saveMatrimonyDraft,
  submitMatrimonyProfile,
  withdrawMatrimonyProfile,
  assertMatrimonyBrowseAllowed
} from "../services/Matrimony.service";
import { validateMatrimonyDraftBody, validateMatrimonySubmitBody } from "../validations/matrimony.validation";
import { MATRIMONY_INCOME_RANGES, MATRIMONY_HEIGHT_OPTIONS, MATRIMONY_COMPLEXION_OPTIONS, PARTNER_GENDER_OPTIONS } from "../constants/matrimony.constants";
import { MATRIMONY_PROFILE_FOR } from "../constants/matrimony-photo.constants";
import * as Discover from "../services/MatrimonyDiscover.service";
import * as MatrimonySafety from "../services/MatrimonySafety.service";
import { reportProfileSchema } from "../validations/matrimony-safety.validation";
import { MATRIMONY_REPORT_REASONS } from "../constants/matrimony-safety.constants";
import {
  discoverQuerySchema,
  sendInterestSchema,
  respondInterestSchema
} from "../validations/matrimony-discovery.validation";
import * as Monetization from "../services/MatrimonyMonetization.service";
import * as SubscriptionLifecycle from "../services/MatrimonySubscriptionLifecycle.service";
import { subscribePlanSchema } from "../validations/matrimony-monetization.validation";
import { assertDevMatrimonyPaymentsAllowed } from "../services/Razorpay.service";

export async function getMe(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const hub = await getMatrimonyHub(userId);
  let subscription: Awaited<ReturnType<typeof Monetization.getSubscriptionSummary>>;
  try {
    subscription = await Monetization.getSubscriptionSummary(userId);
  } catch (err: unknown) {
    console.warn(
      "[matrimony/me] subscription summary failed — run npm run db:run-matrimony-subscription-p1-sql",
      err instanceof Error ? err.message : err
    );
    const period = Monetization.currentBillingPeriod();
    subscription = {
      plan: "FREE",
      planLabel: "Free",
      expiresAt: null,
      quota: { used: 0, limit: 0, period, resetsAt: Monetization.billingPeriodResetsAt(period) },
      features: { canOpenOneStar: false, canOpenTwoStar: false, whoViewedMe: false }
    };
  }
  return success(res, {
    ...hub,
    subscription,
    plans: Monetization.getPlanCatalog()
  });
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
    profile_for: MATRIMONY_PROFILE_FOR,
    report_reasons: MATRIMONY_REPORT_REASONS
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
    if (e.code === "PROFILE_LOCKED") {
      return res.status(403).json({
        ok: false,
        message: e.message,
        code: e.code,
        teaser: e.teaser
      });
    }
    if (e.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function openCandidateProfile(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const candidateUserId = Number(req.params.userId);
  try {
    const data = await Discover.openCandidateProfile(userId, candidateUserId);
    return success(res, data);
  } catch (e: any) {
    if (e instanceof ZodError) return error(res, formatZodMessage(e), 400);
    if (e.status) {
      return res.status(e.status).json({
        ok: false,
        message: e.message,
        code: e.code,
        openRequiresPlan: e.openRequiresPlan
      });
    }
    throw e;
  }
}

export async function getSubscription(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const [subscription, mySubscription] = await Promise.all([
    Monetization.getSubscriptionSummary(userId),
    Monetization.getMySubscriptionDetail(userId)
  ]);
  return success(res, { subscription, mySubscription, plans: Monetization.getPlanCatalog() });
}

export async function getPaymentHistory(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const items = await SubscriptionLifecycle.listUserPaymentHistory(userId);
  return success(res, { items });
}

export async function subscribePlan(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  try {
    assertDevMatrimonyPaymentsAllowed();
    const body = subscribePlanSchema.parse(req.body);
    const subscription = await Monetization.subscribePlan(userId, body.plan, 6);
    return success(res, {
      subscription,
      message: `${body.plan} plan activated (dev billing — connect Razorpay for production).`
    });
  } catch (e: any) {
    if (e instanceof ZodError) return error(res, formatZodMessage(e), 400);
    if (e.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function startContactPayment(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const otherUserId = Number(req.params.userId);
  try {
    const match = await Discover.getActiveMatchForContact(userId, otherUserId);
    const payment = await Monetization.createContactRevealPayment(
      userId,
      otherUserId,
      match?.id ?? null
    );
    return success(res, { payment });
  } catch (e: any) {
    if (e.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function confirmContactPayment(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const otherUserId = Number(req.params.userId);
  try {
    assertDevMatrimonyPaymentsAllowed();
    await Monetization.confirmContactRevealPayment(userId, otherUserId);
    const data = await Discover.revealContactIfMatched(userId, otherUserId);
    return success(res, { ...data, message: "Contact revealed." });
  } catch (e: any) {
    if (e.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function listProfileViews(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  try {
    await assertMatrimonyBrowseAllowed(userId);
    const items = await Monetization.listWhoViewedMe(userId);
    return success(res, { items });
  } catch (e: any) {
    if (e.status) {
      return res.status(e.status).json({
        ok: false,
        message: e.message,
        code: e.code ?? "FORBIDDEN"
      });
    }
    throw e;
  }
}

export async function sendInterest(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  try {
    const body = sendInterestSchema.parse(req.body);
    const data = await Discover.sendInterest(
      userId,
      body.toUserId,
      body.introMessage ?? undefined
    );
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
    const { action, introMessage } = respondInterestSchema.parse(req.body);
    const data = await Discover.respondToInterest(userId, interestId, action, introMessage ?? undefined);
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

export async function requestHoroscope(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const otherUserId = Number(req.params.userId);
  try {
    const data = await Discover.requestHoroscopeShare(userId, otherUserId);
    return success(res, data);
  } catch (e: any) {
    if (e.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function shareHoroscope(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const otherUserId = Number(req.params.userId);
  try {
    const data = await Discover.shareHoroscopeWithMatch(userId, otherUserId);
    return success(res, data);
  } catch (e: any) {
    if (e.status) return error(res, e.message, e.status);
    throw e;
  }
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

export async function listSaved(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  try {
    await assertMatrimonyBrowseAllowed(userId);
    const items = await MatrimonySafety.listSavedProfiles(userId);
    return success(res, { items });
  } catch (e: any) {
    if (e.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function saveProfile(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const candidateUserId = Number(req.params.userId);
  try {
    await assertMatrimonyBrowseAllowed(userId);
    const data = await MatrimonySafety.saveProfile(userId, candidateUserId);
    return success(res, data);
  } catch (e: any) {
    if (e.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function unsaveProfile(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const candidateUserId = Number(req.params.userId);
  try {
    await assertMatrimonyBrowseAllowed(userId);
    await MatrimonySafety.unsaveProfile(userId, candidateUserId);
    return success(res, { ok: true });
  } catch (e: any) {
    if (e.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function blockProfile(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const candidateUserId = Number(req.params.userId);
  try {
    const data = await MatrimonySafety.blockUser(userId, candidateUserId);
    return success(res, data);
  } catch (e: any) {
    if (e.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function unblockProfile(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const candidateUserId = Number(req.params.userId);
  await MatrimonySafety.unblockUser(userId, candidateUserId);
  return success(res, { ok: true });
}

export async function reportProfile(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const reportedUserId = Number(req.params.userId);
  try {
    const body = reportProfileSchema.parse(req.body);
    const data = await MatrimonySafety.reportProfile(
      userId,
      reportedUserId,
      body.reasonCode,
      body.details
    );
    return success(res, data, 201);
  } catch (e: any) {
    if (e instanceof ZodError) return error(res, formatZodMessage(e), 400);
    if (e.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function withdrawProfile(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  try {
    const hub = await withdrawMatrimonyProfile(userId);
    return success(res, { ...hub, message: "Matrimony profile withdrawn from discovery." });
  } catch (e: any) {
    if (e.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function withdrawInterest(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const interestId = Number(req.params.id);
  try {
    const interest = await Discover.withdrawInterest(userId, interestId);
    return success(res, { interest });
  } catch (e: any) {
    if (e.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function getChatAccess(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  const otherUserId = Number(req.params.userId);
  const data = await Discover.getMatrimonyChatAccess(userId, otherUserId);
  return success(res, data);
}
