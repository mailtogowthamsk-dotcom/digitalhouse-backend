type PresenceState = {
  sockets: Map<string, number>; // socketId -> userId
  counts: Map<number, number>; // userId -> active sockets count
};

const state: PresenceState = {
  sockets: new Map(),
  counts: new Map()
};

export function presenceAdd(socketId: string, userId: number) {
  state.sockets.set(socketId, userId);
  state.counts.set(userId, (state.counts.get(userId) ?? 0) + 1);
}

export function presenceRemove(socketId: string) {
  const userId = state.sockets.get(socketId);
  if (!userId) return { userId: null as number | null, becameOffline: false };

  state.sockets.delete(socketId);
  const next = Math.max(0, (state.counts.get(userId) ?? 1) - 1);
  if (next === 0) {
    state.counts.delete(userId);
    return { userId, becameOffline: true };
  }
  state.counts.set(userId, next);
  return { userId, becameOffline: false };
}

export function isOnline(userId: number): boolean {
  return (state.counts.get(userId) ?? 0) > 0;
}

export function listOnlineUserIds(): number[] {
  return Array.from(state.counts.keys());
}

