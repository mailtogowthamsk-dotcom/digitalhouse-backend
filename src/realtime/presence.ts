/**
 * Distributed online presence.
 *
 * - With REDIS_URL: Redis SETs/hashes shared across API instances
 * - Without Redis: in-memory Maps (single Node process only)
 *
 * Public function names match the previous sync API; Redis paths are async.
 */
import { hostname } from "os";
import { getRedis, isRedisConfigured, redisKey } from "../config/redis";

const SERVER_ID = `${hostname()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

type MemoryState = {
  sockets: Map<string, number>;
  counts: Map<number, number>;
  lastSeenAt: Map<number, number>;
};

const memory: MemoryState = {
  sockets: new Map(),
  counts: new Map(),
  lastSeenAt: new Map()
};

function socketRef(socketId: string): string {
  return `${SERVER_ID}:${socketId}`;
}

function kOnline(): string {
  return redisKey(["presence", "online"]);
}
function kUserSockets(userId: number): string {
  return redisKey(["presence", "user", String(userId), "sockets"]);
}
function kSocketUser(ref: string): string {
  return redisKey(["presence", "socket", ref]);
}
function kLastSeen(): string {
  return redisKey(["presence", "lastseen"]);
}
function kServerSockets(): string {
  return redisKey(["presence", "server", SERVER_ID, "sockets"]);
}
function kServerHb(serverId: string = SERVER_ID): string {
  return redisKey(["presence", "server", serverId, "hb"]);
}
function kServers(): string {
  return redisKey(["presence", "servers"]);
}

export function getPresenceServerId(): string {
  return SERVER_ID;
}

export function usesRedisPresence(): boolean {
  return isRedisConfigured() && getRedis() != null;
}

// ── Memory backend ──────────────────────────────────────────

function memoryAdd(socketId: string, userId: number): { becameOnline: boolean } {
  const was = memory.counts.get(userId) ?? 0;
  memory.sockets.set(socketId, userId);
  memory.counts.set(userId, was + 1);
  if (was === 0) memory.lastSeenAt.delete(userId);
  return { becameOnline: was === 0 };
}

function memoryRemove(socketId: string): {
  userId: number | null;
  becameOffline: boolean;
  lastSeenAt: string | null;
} {
  const userId = memory.sockets.get(socketId);
  if (!userId) return { userId: null, becameOffline: false, lastSeenAt: null };
  memory.sockets.delete(socketId);
  const next = Math.max(0, (memory.counts.get(userId) ?? 1) - 1);
  if (next === 0) {
    memory.counts.delete(userId);
    const ts = Date.now();
    memory.lastSeenAt.set(userId, ts);
    return { userId, becameOffline: true, lastSeenAt: new Date(ts).toISOString() };
  }
  memory.counts.set(userId, next);
  return { userId, becameOffline: false, lastSeenAt: null };
}

// ── Redis backend ───────────────────────────────────────────

async function redisAdd(socketId: string, userId: number): Promise<{ becameOnline: boolean }> {
  const redis = getRedis()!;
  const ref = socketRef(socketId);
  const before = await redis.scard(kUserSockets(userId));
  const pipeline = redis.pipeline();
  pipeline.sadd(kUserSockets(userId), ref);
  pipeline.set(kSocketUser(ref), String(userId));
  pipeline.sadd(kServerSockets(), ref);
  pipeline.sadd(kOnline(), String(userId));
  pipeline.hdel(kLastSeen(), String(userId));
  pipeline.sadd(kServers(), SERVER_ID);
  pipeline.set(kServerHb(), "1", "EX", 45);
  await pipeline.exec();
  return { becameOnline: before === 0 };
}

async function redisRemove(socketId: string): Promise<{
  userId: number | null;
  becameOffline: boolean;
  lastSeenAt: string | null;
}> {
  const redis = getRedis()!;
  const ref = socketRef(socketId);
  const userRaw = await redis.get(kSocketUser(ref));
  if (!userRaw) return { userId: null, becameOffline: false, lastSeenAt: null };
  const userId = Number(userRaw);
  if (!Number.isFinite(userId) || userId <= 0) {
    await redis.del(kSocketUser(ref));
    return { userId: null, becameOffline: false, lastSeenAt: null };
  }

  const pipeline = redis.pipeline();
  pipeline.srem(kUserSockets(userId), ref);
  pipeline.del(kSocketUser(ref));
  pipeline.srem(kServerSockets(), ref);
  await pipeline.exec();

  const remaining = await redis.scard(kUserSockets(userId));
  if (remaining === 0) {
    const ts = Date.now();
    await redis
      .pipeline()
      .srem(kOnline(), String(userId))
      .hset(kLastSeen(), String(userId), String(ts))
      .exec();
    return { userId, becameOffline: true, lastSeenAt: new Date(ts).toISOString() };
  }
  return { userId, becameOffline: false, lastSeenAt: null };
}

// ── Public API ──────────────────────────────────────────────

export async function presenceAdd(
  socketId: string,
  userId: number
): Promise<{ becameOnline: boolean }> {
  if (usesRedisPresence()) {
    try {
      return await redisAdd(socketId, userId);
    } catch (err) {
      console.warn(
        "[presence] redis add failed, using memory:",
        err instanceof Error ? err.message : err
      );
    }
  }
  return memoryAdd(socketId, userId);
}

export async function presenceRemove(socketId: string): Promise<{
  userId: number | null;
  becameOffline: boolean;
  lastSeenAt: string | null;
}> {
  if (usesRedisPresence()) {
    try {
      return await redisRemove(socketId);
    } catch (err) {
      console.warn(
        "[presence] redis remove failed, using memory:",
        err instanceof Error ? err.message : err
      );
    }
  }
  return memoryRemove(socketId);
}

export async function isOnline(userId: number): Promise<boolean> {
  if (usesRedisPresence()) {
    try {
      return (await getRedis()!.sismember(kOnline(), String(userId))) === 1;
    } catch {
      /* fall through */
    }
  }
  return (memory.counts.get(userId) ?? 0) > 0;
}

export async function listOnlineUserIds(): Promise<number[]> {
  if (usesRedisPresence()) {
    try {
      const members = await getRedis()!.smembers(kOnline());
      return members.map((m) => Number(m)).filter((n) => Number.isFinite(n) && n > 0);
    } catch {
      /* fall through */
    }
  }
  return Array.from(memory.counts.keys());
}

export async function listLastSeenMap(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (usesRedisPresence()) {
    try {
      const all = await getRedis()!.hgetall(kLastSeen());
      for (const [userId, ts] of Object.entries(all)) {
        if (await isOnline(Number(userId))) continue;
        const n = Number(ts);
        if (Number.isFinite(n)) out[userId] = new Date(n).toISOString();
      }
      return out;
    } catch {
      /* fall through */
    }
  }
  for (const [userId, ts] of memory.lastSeenAt.entries()) {
    if ((memory.counts.get(userId) ?? 0) > 0) continue;
    out[String(userId)] = new Date(ts).toISOString();
  }
  return out;
}

export async function getLastSeenAt(userId: number): Promise<string | null> {
  if (await isOnline(userId)) return null;
  if (usesRedisPresence()) {
    try {
      const ts = await getRedis()!.hget(kLastSeen(), String(userId));
      if (ts == null) return null;
      const n = Number(ts);
      return Number.isFinite(n) ? new Date(n).toISOString() : null;
    } catch {
      /* fall through */
    }
  }
  const ts = memory.lastSeenAt.get(userId);
  return ts != null ? new Date(ts).toISOString() : null;
}

export async function buildPresenceSnapshot(): Promise<{
  onlineUserIds: number[];
  lastSeen: Record<string, string>;
}> {
  return {
    onlineUserIds: await listOnlineUserIds(),
    lastSeen: await listLastSeenMap()
  };
}

export async function buildPresenceSnapshotFor(userIds: Iterable<number>): Promise<{
  scoped: true;
  userIds: number[];
  onlineUserIds: number[];
  lastSeen: Record<string, string>;
}> {
  const requested: number[] = [];
  const onlineUserIds: number[] = [];
  const lastSeen: Record<string, string> = {};

  for (const raw of userIds) {
    const userId = Number(raw);
    if (!Number.isFinite(userId) || userId <= 0) continue;
    requested.push(userId);
    if (await isOnline(userId)) {
      onlineUserIds.push(userId);
      continue;
    }
    const iso = await getLastSeenAt(userId);
    if (iso) lastSeen[String(userId)] = iso;
  }

  return { scoped: true, userIds: requested, onlineUserIds, lastSeen };
}

export async function pruneLastSeen(maxAgeMs: number): Promise<number> {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;

  if (usesRedisPresence()) {
    try {
      const redis = getRedis()!;
      const all = await redis.hgetall(kLastSeen());
      const pipeline = redis.pipeline();
      for (const [userId, ts] of Object.entries(all)) {
        const n = Number(ts);
        if (!Number.isFinite(n) || n >= cutoff) continue;
        if (await isOnline(Number(userId))) continue;
        pipeline.hdel(kLastSeen(), userId);
        removed += 1;
      }
      if (removed > 0) await pipeline.exec();
      return removed;
    } catch {
      /* fall through */
    }
  }

  for (const [userId, ts] of memory.lastSeenAt.entries()) {
    if (ts < cutoff && (memory.counts.get(userId) ?? 0) === 0) {
      memory.lastSeenAt.delete(userId);
      removed += 1;
    }
  }
  return removed;
}

/** Refresh this process's presence heartbeat (call on an interval). */
export async function touchPresenceServerHeartbeat(): Promise<void> {
  if (!usesRedisPresence()) return;
  try {
    const redis = getRedis()!;
    await redis.pipeline().sadd(kServers(), SERVER_ID).set(kServerHb(), "1", "EX", 45).exec();
  } catch {
    /* ignore */
  }
}

/**
 * Drop socket refs owned by dead API instances (crashed without disconnect events).
 * Safe to run from any live instance.
 */
export async function reconcileDeadPresenceServers(): Promise<number> {
  if (!usesRedisPresence()) return 0;
  const redis = getRedis()!;
  let cleaned = 0;
  try {
    const servers = await redis.smembers(kServers());
    for (const serverId of servers) {
      if (serverId === SERVER_ID) continue;
      const alive = await redis.exists(kServerHb(serverId));
      if (alive) continue;

      const serverSocketsKey = redisKey(["presence", "server", serverId, "sockets"]);
      const refs = await redis.smembers(serverSocketsKey);
      for (const ref of refs) {
        const userRaw = await redis.get(kSocketUser(ref));
        const userId = Number(userRaw);
        await redis
          .pipeline()
          .del(kSocketUser(ref))
          .srem(serverSocketsKey, ref)
          .exec();
        if (Number.isFinite(userId) && userId > 0) {
          await redis.srem(kUserSockets(userId), ref);
          const remaining = await redis.scard(kUserSockets(userId));
          if (remaining === 0) {
            const ts = Date.now();
            await redis
              .pipeline()
              .srem(kOnline(), String(userId))
              .hset(kLastSeen(), String(userId), String(ts))
              .exec();
          }
        }
        cleaned += 1;
      }
      await redis.pipeline().del(serverSocketsKey).srem(kServers(), serverId).exec();
    }
  } catch (err) {
    console.warn(
      "[presence] reconcile failed:",
      err instanceof Error ? err.message : err
    );
  }
  return cleaned;
}

/** On process shutdown — remove this instance's sockets from Redis. */
export async function clearLocalPresenceFromRedis(): Promise<void> {
  if (!usesRedisPresence()) return;
  const redis = getRedis()!;
  try {
    const refs = await redis.smembers(kServerSockets());
    for (const ref of refs) {
      const socketId = ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : ref;
      await redisRemove(socketId);
    }
    await redis.pipeline().del(kServerSockets()).del(kServerHb()).srem(kServers(), SERVER_ID).exec();
  } catch (err) {
    console.warn(
      "[presence] clear local failed:",
      err instanceof Error ? err.message : err
    );
  }
}
