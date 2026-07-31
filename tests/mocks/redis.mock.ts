import { vi } from "vitest";

/**
 * Redis mock — Socket.io adapter / presence / push pending keys.
 * Align with src/config/redis.ts + src/realtime/presence.ts.
 *
 * Example:
 *   vi.mock("../../src/config/redis", () => ({
 *     isRedisConfigured: () => true,
 *     getRedis: () => createRedisMock(),
 *     redisKey: (parts: string[]) => ["dh", ...parts].join(":"),
 *     getSocketAdapterClients: async () => null,
 *     closeRedis: async () => undefined,
 *     markRedisInitAttempted: () => undefined,
 *     wasRedisInitAttempted: () => true
 *   }));
 */
export type RedisMock = ReturnType<typeof createRedisMock>;

export function createRedisMock() {
  const store = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();
  const sets = new Map<string, Set<string>>();

  const redis = {
    status: "ready" as string,
    connect: vi.fn(async () => undefined),
    quit: vi.fn(async () => undefined),
    disconnect: vi.fn(() => undefined),
    ping: vi.fn(async () => "PONG"),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    }),
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (...keys: string[]) => {
      let n = 0;
      for (const k of keys) {
        if (store.delete(k)) n++;
        if (hashes.delete(k)) n++;
        if (sets.delete(k)) n++;
      }
      return n;
    }),
    exists: vi.fn(async (key: string) => (store.has(key) || hashes.has(key) || sets.has(key) ? 1 : 0)),
    expire: vi.fn(async () => 1),
    hget: vi.fn(async (key: string, field: string) => hashes.get(key)?.get(field) ?? null),
    hset: vi.fn(async (key: string, field: string, value: string) => {
      if (!hashes.has(key)) hashes.set(key, new Map());
      hashes.get(key)!.set(field, value);
      return 1;
    }),
    hgetall: vi.fn(async (key: string) => {
      const h = hashes.get(key);
      if (!h) return {};
      return Object.fromEntries(h.entries());
    }),
    sadd: vi.fn(async (key: string, ...members: string[]) => {
      if (!sets.has(key)) sets.set(key, new Set());
      let added = 0;
      for (const m of members) {
        if (!sets.get(key)!.has(m)) {
          sets.get(key)!.add(m);
          added++;
        }
      }
      return added;
    }),
    smembers: vi.fn(async (key: string) => [...(sets.get(key) ?? [])]),
    scard: vi.fn(async (key: string) => sets.get(key)?.size ?? 0),
    sismember: vi.fn(async (key: string, member: string) =>
      sets.get(key)?.has(member) ? 1 : 0
    ),
    srem: vi.fn(async (key: string, ...members: string[]) => {
      const set = sets.get(key);
      if (!set) return 0;
      let n = 0;
      for (const m of members) {
        if (set.delete(m)) n++;
      }
      return n;
    }),
    pipeline: vi.fn(() => {
      const ops: Array<() => Promise<unknown>> = [];
      const chain = {
        sadd: (key: string, ...members: string[]) => {
          ops.push(() => redis.sadd(key, ...members));
          return chain;
        },
        srem: (key: string, ...members: string[]) => {
          ops.push(() => redis.srem(key, ...members));
          return chain;
        },
        set: (key: string, value: string, ..._rest: unknown[]) => {
          ops.push(() => redis.set(key, value));
          return chain;
        },
        del: (...keys: string[]) => {
          ops.push(() => redis.del(...keys));
          return chain;
        },
        hset: (key: string, field: string, value: string) => {
          ops.push(() => redis.hset(key, field, value));
          return chain;
        },
        hdel: (key: string, ...fields: string[]) => {
          ops.push(async () => {
            const h = hashes.get(key);
            if (!h) return 0;
            let n = 0;
            for (const f of fields) if (h.delete(f)) n++;
            return n;
          });
          return chain;
        },
        exec: async () => {
          const results: Array<[null, unknown]> = [];
          for (const op of ops) results.push([null, await op()]);
          return results;
        }
      };
      return chain;
    }),
    publish: vi.fn(async () => 0),
    subscribe: vi.fn(async () => undefined),
    duplicate: vi.fn(function (this: RedisMock) {
      return createRedisMock();
    }),
    on: vi.fn(() => redis),
    once: vi.fn(() => redis),
    /** Test helper — wipe in-memory state between cases */
    __reset: () => {
      store.clear();
      hashes.clear();
      sets.clear();
    },
    __store: store
  };

  return redis;
}

/** Vitest module factory for a future `src/utils/redisClient.ts`. */
export function createRedisMockModule() {
  const client = createRedisMock();
  return {
    getRedis: vi.fn(() => client),
    redis: client,
    createRedisMock: () => client
  };
}
