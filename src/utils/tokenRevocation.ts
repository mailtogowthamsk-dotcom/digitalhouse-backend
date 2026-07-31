/**
 * Lightweight JWT revocation without DB schema changes.
 * Stores a per-user minimum acceptable `iat` (unix seconds) in Redis (preferred)
 * or in-process memory (single-instance fallback).
 *
 * Call revokeUserTokens() on suspend / soft-delete / future logout-all.
 * Middleware rejects tokens with iat < minIat.
 *
 * Future enhancement: persist tokenVersion on users table for multi-store durability.
 */
import { getRedis, isRedisConfigured, redisKey } from "../config/redis";
import { logSecurityEvent } from "./securityLog";

const memoryMinIat = new Map<number, number>();

function memGet(userId: number): number {
  return memoryMinIat.get(userId) ?? 0;
}

function redisRevokeKey(userId: number): string {
  return redisKey(["auth", "tokenMinIat", String(userId)]);
}

/** Seconds — keep revoke markers at least as long as longest access token (~7d + buffer). */
function revokeTtlSec(): number {
  const raw = Number(process.env.TOKEN_REVOKE_TTL_SEC || 8 * 24 * 60 * 60);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 8 * 24 * 60 * 60;
}

export async function getTokenMinIat(userId: number): Promise<number> {
  const redis = isRedisConfigured() ? getRedis() : null;
  if (redis) {
    try {
      const v = await redis.get(redisRevokeKey(userId));
      if (v != null) {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      }
    } catch {
      /* fall through */
    }
  }
  return memGet(userId);
}

/** Invalidate all member JWTs issued at or before now for this user. */
export async function revokeUserTokens(userId: number, reason?: string): Promise<void> {
  const minIat = Math.floor(Date.now() / 1000);
  memoryMinIat.set(userId, minIat);
  const redis = isRedisConfigured() ? getRedis() : null;
  if (redis) {
    try {
      await redis.set(redisRevokeKey(userId), String(minIat), "EX", revokeTtlSec());
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
  iat: number | undefined
): Promise<boolean> {
  if (iat == null || !Number.isFinite(iat)) return true; // legacy tokens without iat
  const minIat = await getTokenMinIat(userId);
  if (!minIat) return true;
  return iat >= minIat;
}
