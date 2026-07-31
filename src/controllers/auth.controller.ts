import { Request, Response } from "express";
import { userService } from "../services/user.service";
import { otpService } from "../services/otp.service";
import { signAccessToken } from "../utils/jwt.util";
import { success, error } from "../utils/response";
import {
  registerSchema,
  loginRequestSchema,
  verifyOtpSchema,
  googleAuthSchema,
  completeGoogleProfileSchema,
  submitRegistrationCorrectionSchema,
  registrationPhotoSchema,
  registrationIdentitySchema
} from "../validations/auth.validation";
import * as GoogleAuth from "../services/googleAuth.service";
import { AUTH_PROVIDERS, AUTH_ANALYTICS_EVENTS } from "../constants/auth.constants";
import { trackAuthEvent } from "../services/authAnalytics.service";
import { mergeLinkedProvider, ensureLinkedProviders, resolveLoginSource } from "../utils/authProvider.util";
import { registrationStatusService } from "../services/RegistrationStatus.service";
import { toStorageKeyIfR2 } from "../utils/r2Client";

/**
 * REGISTRATION: Accept full details, save user with status PENDING.
 * Returns a session so the client can optionally upload a profile photo.
 */
export async function register(req: Request, res: Response) {
  try {
    const body = registerSchema.parse(req.body);
    const { legalService } = await import("../services/Legal.service");
    await legalService.assertRegistrationAcceptances(body.legalAcceptances ?? []);

    const user = await userService.register(body);
    if (body.legalAcceptances?.length) {
      await legalService.acceptDocuments({
        userId: user.id,
        documentKeys: body.legalAcceptances.map((a) => a.documentKey),
        source: "registration",
        ipAddress: legalService.clientIp(req as any),
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
        expectedVersions: Object.fromEntries(
          body.legalAcceptances.map((a) => [a.documentKey, a.version])
        )
      });
    }

    const accessToken = signAccessToken({ userId: user.id });
    return success(
      res,
      {
        message:
          "Your registration is under admin verification (1–2 days). You will be notified once approved.",
        accessToken,
        user: userService.toAuthUser(user)
      },
      201
    );
  } catch (e: any) {
    if (e?.status === 409) return error(res, e.message, 409);
    if (e?.status === 400) return error(res, e.message, 400);
    throw e;
  }
}

/**
 * LOGIN REQUEST: Identity step only — issue OTP when the account may receive a session.
 * App access is decided after verify via registration status (not here).
 *
 * Anti-enumeration: unknown emails keep HTTP 404 (mobile LoginScreen branches on status)
 * but use a normalized message. Exact reason is security-logged only.
 */
export async function loginRequest(req: Request, res: Response) {
  const { email } = loginRequestSchema.parse(req.body);
  const genericMessage = "If the account exists, an OTP has been sent.";
  const user = await userService.findByEmail(email);
  if (!user) {
    const { logSecurityEvent } = await import("../utils/securityLog");
    logSecurityEvent("login_unknown_email", { reason: "not_found" });
    return error(res, genericMessage, 404);
  }
  try {
    registrationStatusService.assertCanIssueSession(user);
  } catch (e: any) {
    const { logSecurityEvent } = await import("../utils/securityLog");
    logSecurityEvent("login_blocked", {
      reason: e?.message ?? "blocked",
      status: e?.status ?? 403
    });
    return error(res, e?.message ?? "Unable to sign in.", e?.status ?? 403);
  }
  const result = await otpService.createAndSendOtp(user);
  if (!result.ok) {
    return error(res, result.message, 503);
  }
  return success(res, {
    message: result.message,
    sent: result.sent,
    ...(result.sent === false ? { retryAfterSec: result.retryAfterSec } : {})
  });
}

/**
 * OTP VERIFY: Validate identity, issue JWT. Client routes by registration status.
 */
export async function verifyOtp(req: Request, res: Response) {
  const { email, otp } = verifyOtpSchema.parse(req.body);
  const user = await userService.findByEmail(email);
  if (!user) {
    const { logSecurityEvent } = await import("../utils/securityLog");
    logSecurityEvent("login_unknown_email", { reason: "verify_not_found" });
    return error(res, "If the account exists, an OTP has been sent.", 404);
  }
  try {
    registrationStatusService.assertCanIssueSession(user);
  } catch (e: any) {
    return error(res, e?.message ?? "Unable to sign in.", e?.status ?? 403);
  }
  const result = await otpService.verifyOtpForUser(user.id, email, otp);
  if (!result.valid) return error(res, result.message, 400);
  const linked = mergeLinkedProvider(ensureLinkedProviders(result.user), AUTH_PROVIDERS.EXISTING_LOGIN);
  await result.user.update({
    lastLoginProvider: AUTH_PROVIDERS.EXISTING_LOGIN,
    linkedProviders: linked
  } as any);
  void trackAuthEvent(AUTH_ANALYTICS_EVENTS.EXISTING_LOGIN, {
    userId: result.user.id,
    provider: AUTH_PROVIDERS.EXISTING_LOGIN
  });
  const accessToken = signAccessToken({ userId: result.user.id });
  return success(res, {
    accessToken,
    user: userService.toAuthUser(result.user)
  });
}

/**
 * ME: Return current user from JWT (protected).
 */
export async function getMe(req: Request & { user?: import("../models").User }, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  try {
    const { legalService } = await import("../services/Legal.service");
    const legal = await legalService.getAcceptanceStatus(req.user.id);
    return success(res, { user: userService.toAuthUser(req.user), legal });
  } catch {
    return success(res, { user: userService.toAuthUser(req.user) });
  }
}

/** POST /auth/google — additional login method; existing OTP flow unchanged */
export async function googleAuth(req: Request, res: Response) {
  const { idToken } = googleAuthSchema.parse(req.body);
  try {
    const result = await GoogleAuth.authenticateWithGoogle(idToken);
    return success(res, result);
  } catch (e: any) {
    const status = e?.status ?? 401;
    return error(res, e?.message ?? "Google sign-in failed", status);
  }
}

/** POST /auth/complete-google-profile — mandatory fields for new Google users */
export async function completeGoogleProfile(req: Request & { user?: import("../models").User }, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const body = completeGoogleProfileSchema.parse(req.body);
  try {
    const { legalService } = await import("../services/Legal.service");
    await legalService.assertRegistrationAcceptances(body.legalAcceptances ?? []);

    const user = await GoogleAuth.completeGoogleProfile(req.user.id, body);

    if (body.legalAcceptances?.length) {
      await legalService.acceptDocuments({
        userId: user.id,
        documentKeys: body.legalAcceptances.map((a) => a.documentKey),
        source: "registration",
        ipAddress: legalService.clientIp(req as any),
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
        expectedVersions: Object.fromEntries(
          body.legalAcceptances.map((a) => [a.documentKey, a.version])
        )
      });
    }

    return success(res, { user });
  } catch (e: any) {
    return error(res, e?.message ?? "Failed to complete profile", e?.status ?? 400);
  }
}

/** POST /auth/registration-correction — resubmit mobile / pending photo when CHANGES_REQUESTED */
export async function submitRegistrationCorrection(
  req: Request & { user?: import("../models").User },
  res: Response
) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const body = submitRegistrationCorrectionSchema.parse(req.body);
  try {
    const user = await registrationStatusService.submitRegistrationCorrection(req.user.id, body);
    return success(res, {
      message: "Your updates were submitted for admin review.",
      user: userService.toAuthUser(user)
    });
  } catch (e: any) {
    const status = e?.status ?? 400;
    console.warn("[registration-correction]", {
      userId: req.user.id,
      status,
      message: e?.message,
      mobile: body.mobile ? String(body.mobile).replace(/\d(?=\d{4})/g, "*") : undefined,
      hasPhoto: Boolean(body.profilePhoto)
    });
    return error(res, e?.message ?? "Failed to submit corrections", status);
  }
}

/** POST /auth/registration-photo — set optional profile photo after register (PENDING). */
export async function setRegistrationPhoto(
  req: Request & { user?: import("../models").User },
  res: Response
) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const body = registrationPhotoSchema.parse(req.body);
  const status = req.user.status;
  if (status !== "PENDING" && status !== "PENDING_REVIEW" && status !== "CHANGES_REQUESTED") {
    return error(res, "Profile photo can only be set during registration review.", 403);
  }
  const photo = toStorageKeyIfR2(body.profilePhoto) ?? body.profilePhoto.trim();
  await req.user.update({ profilePhoto: photo } as any);
  try {
    const { mediaService } = await import("../services/Media.service");
    await mediaService.markMediaUrlsAttached(req.user.id, [photo]);
  } catch {
    /* best-effort */
  }
  const user = await req.user.reload();
  return success(res, {
    message: "Profile photo saved.",
    user: userService.toAuthUser(user)
  });
}

/** POST /auth/registration-identity — attach a private ID upload during registration review. */
export async function setRegistrationIdentity(
  req: Request & { user?: import("../models").User },
  res: Response
) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const body = registrationIdentitySchema.parse(req.body);
  const status = req.user.status;
  if (status !== "PENDING" && status !== "PENDING_REVIEW" && status !== "CHANGES_REQUESTED") {
    return error(res, "Identity documents can only be set during registration review.", 403);
  }

  const key = toStorageKeyIfR2(body.govtIdFile);
  const ownedPrefix = `digital-house/private/ids/${req.user.id}/`;
  if (!key?.startsWith(ownedPrefix)) {
    return error(res, "Invalid private identity document reference.", 400);
  }

  await req.user.update({
    govtIdType: body.govtIdType,
    govtIdFile: key
  } as any);
  try {
    const { mediaService } = await import("../services/Media.service");
    await mediaService.markMediaUrlsAttached(req.user.id, [key]);
  } catch {
    /* best-effort */
  }
  return success(res, {
    message: "Identity document saved.",
    user: userService.toAuthUser(await req.user.reload())
  });
}

/** GET /auth/linked-accounts — account security section */
export async function linkedAccounts(req: Request & { user?: import("../models").User }, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const accounts = GoogleAuth.getLinkedAccountsForUser(req.user);
  return success(res, { ...accounts, loginSource: resolveLoginSource(req.user) });
}
