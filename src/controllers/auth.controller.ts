import { Request, Response } from "express";
import { userService } from "../services/user.service";
import { otpService } from "../services/otp.service";
import { sendRegistrationCode, verifyRegistrationCode } from "../services/registrationEmail.service";
import type { SessionRequest } from "../middlewares/auth.middleware";
import { signAccessToken, type AccessTokenClaims } from "../utils/jwt.util";
import { success, error } from "../utils/response";
import {
  registerSchema,
  registrationContactSchema,
  loginRequestSchema,
  verifyOtpSchema,
  googleAuthSchema,
  completeGoogleProfileSchema,
  submitRegistrationCorrectionSchema,
  registrationPhotoSchema,
  registrationIdentitySchema,
  submitReferralCodeSchema
} from "../validations/auth.validation";
import * as GoogleAuth from "../services/googleAuth.service";
import { AUTH_PROVIDERS, AUTH_ANALYTICS_EVENTS } from "../constants/auth.constants";
import { trackAuthEvent } from "../services/authAnalytics.service";
import { mergeLinkedProvider, ensureLinkedProviders, resolveLoginSource } from "../utils/authProvider.util";
import { registrationStatusService } from "../services/RegistrationStatus.service";
import { toStorageKeyIfR2 } from "../utils/r2Client";
import { validateUsernameAvailabilityQuery } from "../validations/users.validation";
import { usernameService } from "../services/Username.service";

export async function checkRegistrationUsername(
  req: Request & { user?: import("../models").User },
  res: Response
) {
  res.set("Cache-Control", "no-store");
  const { username } = validateUsernameAvailabilityQuery(req.query);
  try {
    const available = await usernameService.isUsernameAvailable(username, req.user?.id);
    return success(res, { available });
  } catch (e: any) {
    if (e?.code === "USERNAME_RESERVED") return success(res, { available: false });
    if (e?.status === 400) return error(res, e.message, 400);
    throw e;
  }
}

export async function checkRegistrationContacts(
  req: Request & { user?: import("../models").User },
  res: Response
) {
  res.set("Cache-Control", "no-store");
  const { email, mobile } = registrationContactSchema.parse(req.body);
  const [emailOwner, mobileOwner] = await Promise.all([
    userService.findByEmail(email),
    userService.findByMobile(mobile)
  ]);
  const userId = req.user?.id;
  return success(res, {
    emailConflict: Boolean(emailOwner && emailOwner.id !== userId),
    mobileConflict: Boolean(mobileOwner && mobileOwner.id !== userId)
  });
}

export async function requestRegistrationEmailCode(req: Request, res: Response) {
  const { email } = loginRequestSchema.parse(req.body);
  res.set("Cache-Control", "no-store");
  const result = await sendRegistrationCode(email);
  if (!result.sent) {
    res.set("Retry-After", String(result.retryAfterSeconds));
    return res.status(429).json({
      ok: false,
      message: "Wait before requesting another code.",
      retryAfterSeconds: result.retryAfterSeconds
    });
  }
  return success(res, { retryAfterSeconds: result.retryAfterSeconds });
}

export async function confirmRegistrationEmailCode(req: Request, res: Response) {
  const { email, otp } = verifyOtpSchema.parse(req.body);
  res.set("Cache-Control", "no-store");
  const result = await verifyRegistrationCode(email, otp);
  if (result.error) return error(res, result.error, 400);
  return success(res, { proof: result.proof, expiresInSeconds: result.expiresInSeconds });
}

export async function checkGoogleRegistration(req: Request, res: Response) {
  const { idToken } = googleAuthSchema.parse(req.body);
  res.set("Cache-Control", "no-store");
  const google = await GoogleAuth.verifyGoogleIdToken(idToken, { allowUnverifiedEmail: true });
  const [googleOwner, emailOwner] = await Promise.all([
    userService.findByGoogleId(google.sub),
    userService.findByEmail(google.email)
  ]);
  if (googleOwner || emailOwner) {
    return res.status(409).json({
      ok: false,
      code: googleOwner ? "GOOGLE_ACCOUNT_EXISTS" : "EMAIL_ALREADY_REGISTERED",
      message: googleOwner
        ? "This Google account is already registered. Sign in with Google to continue."
        : "This email already has an account. Sign in to continue."
    });
  }
  return success(res, { email: google.email, requiresEmailOtp: !google.authoritativeEmail });
}

/**
 * REGISTRATION: Accept full details, save user with status PENDING.
 * Returns a session so the client can optionally upload a profile photo.
 */
export async function register(req: Request, res: Response) {
  return submitRegistration(req, res);
}

export async function resumeRegistration(req: SessionRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  return submitRegistration(req, res, req.user.id, req.authClaims);
}

async function submitRegistration(
  req: Request,
  res: Response,
  resumeUserId?: number,
  authClaims?: AccessTokenClaims
) {
  try {
    const body = registerSchema.parse(req.body);
    const googleIdentity = resumeUserId === undefined && body.googleIdToken
      ? await GoogleAuth.verifyGoogleIdToken(body.googleIdToken, { allowUnverifiedEmail: true })
      : undefined;
    if (resumeUserId !== undefined && !body.profilePhoto?.trim()) {
      return error(res, "Please add a profile photo.", 400);
    }
    const { legalService } = await import("../services/Legal.service");
    await legalService.assertRegistrationAcceptances(body.legalAcceptances ?? []);

    const user = await userService.register(body, resumeUserId, googleIdentity);
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

    if (resumeUserId !== undefined && user.profilePhoto) {
      await markRegistrationPhotoAttached(user.id, user.profilePhoto);
    }

    const googleSub = googleIdentity?.sub ??
      (authClaims?.purpose === "google_registration" ? authClaims.googleSub : undefined);
    const accessToken = signAccessToken(googleSub && user.googleId === googleSub
      ? { userId: user.id, purpose: "google_registration", googleSub }
      : { userId: user.id, purpose: "registration" });
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
    if (e?.code === "LEGAL_ACCEPTANCE_REQUIRED" || e?.code === "LEGAL_VERSION_STALE") {
      return res.status(e.status).json({ ok: false, code: e.code, message: e.message });
    }
    if (e?.code === "INVALID_GOOGLE_TOKEN") {
      return res.status(401).json({ ok: false, code: e.code, message: "Select your Google account again to continue." });
    }
    if (["REGISTRATION_EMAIL_VERIFICATION_REQUIRED", "GOOGLE_EMAIL_MISMATCH"].includes(e?.code)) {
      return res.status(400).json({ ok: false, code: e.code, message: e.message });
    }
    if (["USERNAME_TAKEN", "EMAIL_ALREADY_REGISTERED", "MOBILE_ALREADY_REGISTERED", "GOOGLE_ACCOUNT_EXISTS"].includes(e?.code)) {
      return res.status(409).json({ ok: false, message: e.message, code: e.code });
    }
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
  const accessToken = signAccessToken({
    userId: result.user.id,
    purpose: ["PENDING", "PENDING_REVIEW", "CHANGES_REQUESTED"].includes(result.user.status)
      ? "registration"
      : undefined
  });
  return success(res, {
    accessToken,
    user: userService.toAuthUser(result.user)
  });
}

/**
 * ME: Return current user from JWT (protected).
 */
export async function getMe(req: SessionRequest, res: Response) {
  res.set("Cache-Control", "no-store");
  if (!req.user) return error(res, "Unauthorized", 401);
  const user = userService.toAuthUser(req.user);
  const approved = req.user.status === "APPROVED";
  const claims = req.authClaims;
  const canUpgrade = approved && claims?.purpose === "google_registration" &&
    Boolean(claims.googleSub && claims.googleSub === req.user.googleId);
  const accessToken = canUpgrade
    ? signAccessToken({ userId: req.user.id, registrationUpgrade: true })
    : undefined;
  const session = {
    accessToken,
    registrationUpgrade: canUpgrade || (claims?.purpose == null && claims?.registrationUpgrade === true),
    requiresSignIn: approved && claims?.purpose != null && !canUpgrade
  };
  try {
    const { legalService } = await import("../services/Legal.service");
    const legal = await legalService.getAcceptanceStatus(req.user.id);
    return success(res, { user, legal, ...session });
  } catch {
    return success(res, { user, ...session });
  }
}

/** POST /auth/google — additional login method; existing OTP flow unchanged */
export async function googleAuth(req: Request, res: Response) {
  const { idToken } = googleAuthSchema.parse(req.body);
  try {
    const result = await GoogleAuth.authenticateWithGoogle(idToken);
    if ("registrationRequired" in result) {
      return res.status(404).json({
        ok: false,
        code: "GOOGLE_REGISTRATION_REQUIRED",
        message: "This Google account is not registered. Create an account to continue.",
        email: result.email
      });
    }
    console.log(
      `[auth/google] ok userId=${result.user?.id} new=${result.isNewUser} linked=${result.linkedExistingAccount}`
    );
    return success(res, result);
  } catch (e: any) {
    const status = e?.status ?? 401;
    const message = e?.message ?? "Google sign-in failed";
    console.warn(`[auth/google] fail status=${status} code=${e?.code ?? "?"} message=${message}`);
    return error(res, message, status);
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
  await markRegistrationPhotoAttached(req.user.id, photo);
  const user = await req.user.reload();
  return success(res, {
    message: "Profile photo saved.",
    user: userService.toAuthUser(user)
  });
}

async function markRegistrationPhotoAttached(userId: number, photo: string) {
  try {
    const { mediaService } = await import("../services/Media.service");
    await mediaService.markMediaUrlsAttached(userId, [photo]);
  } catch {
    /* best-effort */
  }
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

export async function getMyReferralCode(req: Request & { user?: import("../models").User }, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  try {
    const { referralService } = await import("../services/Referral.service");
    const data = await referralService.getOrCreateOwnReferralCode(req.user.id);
    return success(res, data);
  } catch (e: any) {
    return error(res, e?.message ?? "Referral code unavailable", e?.status ?? 400);
  }
}

export async function regenerateMyReferralCode(
  req: Request & { user?: import("../models").User },
  res: Response
) {
  if (!req.user) return error(res, "Unauthorized", 401);
  try {
    const { referralService } = await import("../services/Referral.service");
    const data = await referralService.regenerateOwnReferralCode(req.user.id);
    return success(res, data);
  } catch (e: any) {
    return error(res, e?.message ?? "Could not regenerate referral code", e?.status ?? 400);
  }
}

export async function getMyReferralStatus(req: Request & { user?: import("../models").User }, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const { referralService } = await import("../services/Referral.service");
  const data = await referralService.getOwnReferralStatus(req.user.id);
  return success(res, data);
}

export async function submitReferralCode(req: Request & { user?: import("../models").User }, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const body = submitReferralCodeSchema.parse(req.body);
  try {
    const { referralService } = await import("../services/Referral.service");
    const data = await referralService.submitReferralCode(req.user.id, body.referralCode);
    return success(res, {
      message: "Referral submitted successfully. Your registration is pending admin verification.",
      ...data
    });
  } catch (e: any) {
    return error(res, e?.message ?? "Invalid referral code. Please check the code and try again.", e?.status ?? 400);
  }
}
