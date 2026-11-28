/**
 * Lightweight JWT revocation without DB schema changes.
 * Stores a per-user minimum acceptable `iat` (unix seconds) in Redis (preferred)
 * or in-process memory (single-instance fallback).
 *
 * Call revokeUserTokens() on suspend / soft-delete / admin force-logout / registration approve.
 * Middleware rejects tokens with iat < minIat.
 *
 * Future enhancement: persist tokenVersion on users table for multi-store durability.
 */
import { getRedis, isRedisConfigured, redisKey } from "../config/redis";
import type { MemberTokenPurpose } from "./jwt.util";
import { logSecurityEvent } from "./securityLog";

const memoryMinIat = new Map<string, number>();

function redisRevokeKey(userId: number, purpose?: MemberTokenPurpose): string {
  return redisKey(["auth", purpose != null ? "registrationTokenMinIat" : "tokenMinIat", String(userId)]);
}

/** Seconds — keep revoke markers at least as long as longest access token (~7d + buffer). */
function revokeTtlSec(): number {
  const raw = Number(process.env.TOKEN_REVOKE_TTL_SEC || 8 * 24 * 60 * 60);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 8 * 24 * 60 * 60;
}

export async function getTokenMinIat(userId: number, purpose?: MemberTokenPurpose): Promise<number> {
  const key = redisRevokeKey(userId, purpose);
  const redis = isRedisConfigured() ? getRedis() : null;
  if (redis) {
    try {
      const v = await redis.get(key);
      if (v != null) {
        const n = Number(v);
        if (Number.isFinite(n)) return Math.max(n, memoryMinIat.get(key) ?? 0);
      }
    } catch (err) {
      if (purpose != null) throw err;
      // Ordinary sessions retain the existing local fallback.
    }
  }
  return memoryMinIat.get(key) ?? 0;
}

/** Invalidate all member JWTs issued at or before now for this user. */
export async function revokeUserTokens(
  userId: number,
  reason?: string,
  options?: { approvalStartedAt?: Date }
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const keys = [redisRevokeKey(userId)];
  if (!options?.approvalStartedAt) keys.push(redisRevokeKey(userId, "registration"));
  // An approval must allow a new member token in the same second. An explicit
  // revocation also invalidates credentials issued earlier in that second.
  const minIat = options?.approvalStartedAt
    ? Math.floor(options.approvalStartedAt.getTime() / 1000)
    : now + 1;
  for (const key of keys) memoryMinIat.set(key, Math.max(memoryMinIat.get(key) ?? 0, minIat));
  try {
    const { invalidateAuthGateCache } = await import("../middlewares/auth.middleware");
    invalidateAuthGateCache(userId);
  } catch {
    /* ignore */
  }
  const redis = isRedisConfigured() ? getRedis() : null;
  if (redis) {
    try {
      const batch = redis.multi();
      for (const key of keys) {
        batch.eval(
          `local current = tonumber(redis.call('GET', KEYS[1]) or '0')
           local next = tonumber(ARGV[1])
           if next >= current then redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2]) end
           return 1`,
          1,
          key,
          String(memoryMinIat.get(key)),
          String(revokeTtlSec())
        );
      }
      const results = await batch.exec();
      if (!results || results.some(([err]) => err)) throw new Error("Revocation write failed");
    } catch (e) {
      console.warn(
        "[security] token revoke Redis write failed — in-memory only:",
        e instanceof Error ? e.message : e
      );
    }
  }
  logSecurityEvent("token_revoked", { userId, reason: reason ?? "revoke", minIat });
}

/** Returns false if the JWT iat is below the user's revoke watermark. */
export async function isAccessTokenActive(
  userId: number,
  iat: number | undefined,
  purpose?: MemberTokenPurpose
): Promise<boolean> {
  if (iat == null || !Number.isFinite(iat)) return purpose == null;
  const minIat = await getTokenMinIat(userId, purpose);
  if (!minIat) return true;
  return iat >= minIat;
}
