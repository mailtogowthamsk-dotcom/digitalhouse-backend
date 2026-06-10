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
  completeGoogleProfileSchema
} from "../validations/auth.validation";
import * as GoogleAuth from "../services/googleAuth.service";
import { AUTH_PROVIDERS, AUTH_ANALYTICS_EVENTS } from "../constants/auth.constants";
import { trackAuthEvent } from "../services/authAnalytics.service";
import { mergeLinkedProvider, ensureLinkedProviders } from "../utils/authProvider.util";

/**
 * REGISTRATION: Accept full details, save user with status PENDING.
 * Return friendly message that admin verification takes 1–2 days.
 */
export async function register(req: Request, res: Response) {
  const body = registerSchema.parse(req.body);
  const user = await userService.register(body);
  return success(
    res,
    {
      message:
        "Your registration is under admin verification (1–2 days). You will be notified once approved.",
      user: userService.toSafeUser(user)
    },
    201
  );
}

/**
 * LOGIN REQUEST: User submits email.
 * If user does not exist or status != APPROVED → block and return verification pending message.
 * If APPROVED → generate OTP, save, send email.
 */
export async function loginRequest(req: Request, res: Response) {
  const { email } = loginRequestSchema.parse(req.body);
  const user = await userService.findByEmail(email);
  if (!user) {
    return error(res, "No account found with this email. Please register first.", 404);
  }
  if (user.status === "PENDING") {
    return error(res, "Your account is under verification. You will be able to login once an admin approves (1–2 days).", 403);
  }
  if (user.status === "REJECTED") {
    return error(res, "Your account was not approved. Please contact support.", 403);
  }
  const result = await otpService.createAndSendOtp(user);
  if (!result.ok) {
    return error(res, result.message, 503);
  }
  return success(res, { message: result.message });
}

/**
 * OTP VERIFY: Validate OTP, mark as used, return JWT and user.
 */
export async function verifyOtp(req: Request, res: Response) {
  const { email, otp } = verifyOtpSchema.parse(req.body);
  const user = await userService.findByEmail(email);
  if (!user) return error(res, "User not found.", 404);
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
  return success(res, { user: userService.toAuthUser(req.user) });
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
    const user = await GoogleAuth.completeGoogleProfile(req.user.id, body);
    return success(res, { user });
  } catch (e: any) {
    return error(res, e?.message ?? "Failed to complete profile", e?.status ?? 400);
  }
}

/** GET /auth/linked-accounts — account security section */
export async function linkedAccounts(req: Request & { user?: import("../models").User }, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const accounts = GoogleAuth.getLinkedAccountsForUser(req.user);
  return success(res, { ...accounts, loginSource: userService.toAdminUser(req.user).loginSource });
}
