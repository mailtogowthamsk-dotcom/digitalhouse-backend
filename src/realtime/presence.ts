/**
 * In-memory online presence registry (single Node process).
 * Multi-device: user stays online while any socket for that userId is connected.
 */

type PresenceState = {
  sockets: Map<string, number>; // socketId -> userId
  counts: Map<number, number>; // userId -> active sockets count
  /** Epoch ms when user last went fully offline (all sockets gone). */
  lastSeenAt: Map<number, number>;
};

const state: PresenceState = {
  sockets: new Map(),
  counts: new Map(),
  lastSeenAt: new Map()
};

export function presenceAdd(socketId: string, userId: number): { becameOnline: boolean } {
  const was = state.counts.get(userId) ?? 0;
  state.sockets.set(socketId, userId);
  state.counts.set(userId, was + 1);
  if (was === 0) {
    state.lastSeenAt.delete(userId);
  }
  return { becameOnline: was === 0 };
}

export function presenceRemove(socketId: string): {
  userId: number | null;
  becameOffline: boolean;
  lastSeenAt: string | null;
} {
  const userId = state.sockets.get(socketId);
  if (!userId) {
    return { userId: null, becameOffline: false, lastSeenAt: null };
  }

  state.sockets.delete(socketId);
  const next = Math.max(0, (state.counts.get(userId) ?? 1) - 1);
  if (next === 0) {
    state.counts.delete(userId);
    const ts = Date.now();
    state.lastSeenAt.set(userId, ts);
    return { userId, becameOffline: true, lastSeenAt: new Date(ts).toISOString() };
  }
  state.counts.set(userId, next);
  return { userId, becameOffline: false, lastSeenAt: null };
}

export function isOnline(userId: number): boolean {
  return (state.counts.get(userId) ?? 0) > 0;
}

export function listOnlineUserIds(): number[] {
  return Array.from(state.counts.keys());
}

/** ISO timestamps for users currently offline who have a recorded last-seen. */
export function listLastSeenMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [userId, ts] of state.lastSeenAt.entries()) {
    if (isOnline(userId)) continue;
    out[String(userId)] = new Date(ts).toISOString();
  }
  return out;
}

export function getLastSeenAt(userId: number): string | null {
  if (isOnline(userId)) return null;
  const ts = state.lastSeenAt.get(userId);
  return ts != null ? new Date(ts).toISOString() : null;
}

export function buildPresenceSnapshot(): {
  onlineUserIds: number[];
  lastSeen: Record<string, string>;
} {
  return {
    onlineUserIds: listOnlineUserIds(),
    lastSeen: listLastSeenMap()
  };
}

/**
 * Snapshot limited to the peers a client actually renders. Keeps the payload
 * bounded instead of shipping the whole online registry to every socket.
 */
export function buildPresenceSnapshotFor(userIds: Iterable<number>): {
  scoped: true;
  userIds: number[];
  onlineUserIds: number[];
  lastSeen: Record<string, string>;
} {
  const requested: number[] = [];
  const onlineUserIds: number[] = [];
  const lastSeen: Record<string, string> = {};

  for (const raw of userIds) {
    const userId = Number(raw);
    if (!Number.isFinite(userId) || userId <= 0) continue;
    requested.push(userId);
    if (isOnline(userId)) {
      onlineUserIds.push(userId);
      continue;
    }
    const ts = state.lastSeenAt.get(userId);
    if (ts != null) lastSeen[String(userId)] = new Date(ts).toISOString();
  }

  // `scoped` tells the client to merge rather than replace its cache, so a
  // per-conversation lookup cannot erase what it knows about other users.
  return { scoped: true, userIds: requested, onlineUserIds, lastSeen };
}

/**
 * Drop last-seen entries older than the retention window so the map cannot grow
 * for the lifetime of the process. Called on a low-frequency interval.
 */
export function pruneLastSeen(maxAgeMs: number): number {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const [userId, ts] of state.lastSeenAt.entries()) {
    if (ts < cutoff && !isOnline(userId)) {
      state.lastSeenAt.delete(userId);
      removed += 1;
    }
  }
  return removed;
}
