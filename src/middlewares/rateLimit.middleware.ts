import { createHash } from "crypto";
import type { Request } from "express";
import rateLimit, { type Options } from "express-rate-limit";

/**
 * Prefer Authorization token as bucket key so:
 * - users behind the same NAT / office Wi‑Fi do not share one limit
 * - misconfigured X-Forwarded-For (everyone as 127.0.0.1) does not rate-limit the whole app
 * Fall back to IP for anonymous routes (auth, public).
 */
export function rateLimitKey(req: Request): string {
  const auth = String(req.headers.authorization || "").trim();
  if (auth.length > 16) {
    return `tok:${createHash("sha256").update(auth).digest("hex").slice(0, 32)}`;
  }
  return `ip:${req.ip || req.socket.remoteAddress || "unknown"}`;
}

const common: Partial<Options> = {
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
  // express-rate-limit v7 validates IPv6; custom keys are intentional
  validate: { keyGeneratorIpFallback: false }
};

/** Standard API limiter (authenticated product APIs). Mobile apps poll several screens. */
export const apiLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT_PER_MIN || 480),
  message: { ok: false, message: "Too many requests. Please wait a moment and try again." }
});

/** Stricter limiter for auth / OTP / admin login. */
export const authLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: { ok: false, message: "Too many attempts. Please try again later." }
});

/** Dedicated admin login limiter (stricter than general auth). */
export const adminLoginLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { ok: false, message: "Too many login attempts. Please try again later." }
});

/** Very strict for OTP request (email/SMS cost). */
export const otpRequestLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { ok: false, message: "Too many login codes requested. Please wait and try again." }
});

/** Referral code lookup/submit — limits guessing and enumeration. */
export const referralSubmitLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { ok: false, message: "Too many referral attempts. Please try again later." }
});

/** Public platform bootstrap / ad events. */
export const publicPlatformLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  max: 90,
  message: { ok: false, message: "Too many requests" }
});

/** Impression/click ingest — tighter than general API to limit analytics spam. */
export const advertisementEventLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  max: 40,
  message: { ok: false, message: "Too many advertisement events" }
});

/** Public website contact form (SMTP cost + spam). */
export const websiteContactLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: { ok: false, message: "Too many messages. Please try again later." }
});

/** Chat / threads — frequent focus refreshes + realtime fallbacks. */
export const messagesApiLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  max: Number(process.env.MESSAGES_RATE_LIMIT_PER_MIN || 360),
  message: { ok: false, message: "Too many chat requests. Please wait a moment." }
});

/** Per-router authenticated API limiter (token-keyed). */
export function routeApiLimiter(maxPerMinute: number) {
  return rateLimit({
    ...common,
    windowMs: 60 * 1000,
    max: maxPerMinute,
    message: { ok: false, message: "Too many requests" }
  });
}
