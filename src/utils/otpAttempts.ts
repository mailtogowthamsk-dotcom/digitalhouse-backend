/**
 * OTP failed-attempt counters without a DB schema change.
 * Prefers Redis (atomic, multi-instance); falls back to in-process Map.
 */
import { getRedis, isRedisConfigured, redisKey } from "../config/redis";

type MemEntry = { count: number; expiresAt: number };

const memory = new Map<string, MemEntry>();

function memKey(otpId: number): string {
  return `otp:${otpId}`;
}

function redisAttemptsKey(otpId: number): string {
  return redisKey(["otp", "attempts", String(otpId)]);
}

function pruneMemory(): void {
  const now = Date.now();
  for (const [k, v] of memory) {
    if (v.expiresAt <= now) memory.delete(k);
  }
}

/** Increment and return the new attempt count for this OTP row. */
export async function incrementOtpAttempts(
  otpId: number,
  ttlSec: number
): Promise<number> {
  const ttl = Math.max(1, Math.floor(ttlSec));
  const redis = isRedisConfigured() ? getRedis() : null;
  if (redis) {
    try {
      const key = redisAttemptsKey(otpId);
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, ttl);
      return count;
    } catch {
      /* fall through to memory */
    }
  }
  pruneMemory();
  const key = memKey(otpId);
  const now = Date.now();
  const prev = memory.get(key);
  if (!prev || prev.expiresAt <= now) {
    memory.set(key, { count: 1, expiresAt: now + ttl * 1000 });
    return 1;
  }
  prev.count += 1;
  return prev.count;
}

export async function clearOtpAttempts(otpId: number): Promise<void> {
  const redis = isRedisConfigured() ? getRedis() : null;
  if (redis) {
    try {
      await redis.del(redisAttemptsKey(otpId));
    } catch {
      /* ignore */
    }
  }
  memory.delete(memKey(otpId));
}

export async function getOtpAttempts(otpId: number): Promise<number> {
  const redis = isRedisConfigured() ? getRedis() : null;
  if (redis) {
    try {
      const n = await redis.get(redisAttemptsKey(otpId));
      return n ? Number(n) || 0 : 0;
    } catch {
      /* fall through */
    }
  }
  const prev = memory.get(memKey(otpId));
  if (!prev || prev.expiresAt <= Date.now()) return 0;
  return prev.count;
}
