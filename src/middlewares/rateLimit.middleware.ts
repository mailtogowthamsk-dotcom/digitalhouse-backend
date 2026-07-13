import rateLimit from "express-rate-limit";

/** Standard API limiter (authenticated product APIs). */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { ok: false, message: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false
});

/** Stricter limiter for auth / OTP / admin login. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: { ok: false, message: "Too many attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false
});

/** Very strict for OTP request (email/SMS cost). */
export const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { ok: false, message: "Too many login codes requested. Please wait and try again." },
  standardHeaders: true,
  legacyHeaders: false
});

/** Public platform bootstrap / ad events. */
export const publicPlatformLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 90,
  message: { ok: false, message: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false
});
