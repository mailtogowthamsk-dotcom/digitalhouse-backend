/**
 * Shared Redis clients for Socket.IO adapter + distributed presence.
 *
 * Enable with REDIS_URL (e.g. redis://:pass@127.0.0.1:6379/0).
 * When unset, realtime falls back to in-process memory (single-instance only).
 */
import { Redis, type RedisOptions } from "ioredis";

let shared: Redis | null = null;
let pub: Redis | null = null;
let sub: Redis | null = null;
let initAttempted = false;

export function isRedisConfigured(): boolean {
  const url = (process.env.REDIS_URL || "").trim();
  return url.length > 0;
}

function redisUrlFromEnv(): string {
  const url = (process.env.REDIS_URL || "").trim();
  if (!url) {
    throw new Error("REDIS_URL is not set");
  }
  // Prefer URL string — ioredis parses redis:// and rediss://
  return url;
}

const commandClientOptions: RedisOptions = {
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
  lazyConnect: false
};

const adapterClientOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true
};

export function getRedis(): Redis | null {
  if (!isRedisConfigured()) return null;
  if (shared) return shared;
  shared = new Redis(redisUrlFromEnv(), commandClientOptions);
  shared.on("error", (err) => {
    console.warn("[redis] client error:", err instanceof Error ? err.message : err);
  });
  return shared;
}

/**
 * Dedicated pub/sub pair for @socket.io/redis-adapter.
 * Subscriber must not share commands with the command client.
 */
export async function getSocketAdapterClients(): Promise<{
  pubClient: Redis;
  subClient: Redis;
} | null> {
  if (!isRedisConfigured()) return null;
  if (pub && sub) return { pubClient: pub, subClient: sub };

  pub = new Redis(redisUrlFromEnv(), adapterClientOptions);
  sub = pub.duplicate();  pub.on("error", (err) => {
    console.warn("[redis] pub error:", err instanceof Error ? err.message : err);
  });
  sub.on("error", (err) => {
    console.warn("[redis] sub error:", err instanceof Error ? err.message : err);
  });

  // ioredis connects automatically; wait until ready
  await Promise.all([
    new Promise<void>((resolve, reject) => {
      if (pub!.status === "ready") return resolve();
      pub!.once("ready", () => resolve());
      pub!.once("error", reject);
    }),
    new Promise<void>((resolve, reject) => {
      if (sub!.status === "ready") return resolve();
      sub!.once("ready", () => resolve());
      sub!.once("error", reject);
    })
  ]);

  return { pubClient: pub, subClient: sub };
}

export async function closeRedis(): Promise<void> {
  const clients = [shared, pub, sub].filter(Boolean) as Redis[];
  shared = null;
  pub = null;
  sub = null;
  initAttempted = false;
  await Promise.all(
    clients.map((c) =>
      c.quit().catch(() => {
        c.disconnect();
      })
    )
  );
}

export function redisKey(parts: string[]): string {
  const prefix = (process.env.REDIS_KEY_PREFIX || "dh").replace(/:$/, "");
  return [prefix, ...parts].join(":");
}

/** True after a successful adapter attach attempt (or skipped when not configured). */
export function markRedisInitAttempted(): void {
  initAttempted = true;
}

export function wasRedisInitAttempted(): boolean {
  return initAttempted;
}
