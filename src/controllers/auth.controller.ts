import { Request, Response } from "express";
import { userService } from "../services/user.service";
import { otpService } from "../services/otp.service";
import { signAccessToken } from "../utils/jwt.util";
import { success, error } from "../utils/response";
import { registerSchema, loginRequestSchema, verifyOtpSchema } from "../validations/auth.validation";

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
  const accessToken = signAccessToken({ userId: result.user.id });
  return success(res, {
    accessToken,
    user: userService.toSafeUser(result.user)
  });
}

/**
 * ME: Return current user from JWT (protected).
 */
export async function getMe(req: Request & { user?: import("../models").User }, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  return success(res, { user: userService.toSafeUser(req.user) });
}
