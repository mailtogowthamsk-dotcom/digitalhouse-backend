import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { verifyAccessToken } from "../utils/jwt.util";
import { User } from "../models";
import { Message } from "../models";
import {
  presenceAdd,
  presenceRemove,
  buildPresenceSnapshotFor,
  pruneLastSeen,
  touchPresenceServerHeartbeat,
  reconcileDeadPresenceServers,
  clearLocalPresenceFromRedis,
  usesRedisPresence,
  getPresenceServerId
} from "./presence";
import { setIo, communityRoom, userRoom, presenceRoom } from "./io";
import { cancelMessagePush } from "./messagePushQueue";
import { isAllowedOrigin } from "../config/cors";
import {
  getSocketAdapterClients,
  isRedisConfigured,
  markRedisInitAttempted,
  closeRedis
} from "../config/redis";
import { getMessageAccess, getMessageAccessMap } from "../services/MessagePermission.service";
import { logSecurityEvent } from "../utils/securityLog";

type AuthedSocketData = { userId: number };

const isDev = process.env.NODE_ENV !== "production";

/** Upper bound on peers one client may watch, so a socket cannot join unbounded rooms. */
const MAX_PRESENCE_WATCH = 300;

/** Minimum gap between relayed typing events from one socket. */
const TYPING_MIN_INTERVAL_MS = 400;

/** Last-seen entries older than this are dropped. */
const LAST_SEEN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const LAST_SEEN_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const PRESENCE_HB_INTERVAL_MS = 15_000;
const PRESENCE_RECONCILE_INTERVAL_MS = 60_000;

function chatLog(...args: unknown[]) {
  if (isDev) console.log("[socket]", ...args);
}

function normalizeUserIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const value of raw) {
    const id = Number(value);
    if (Number.isFinite(id) && id > 0 && !out.includes(id)) out.push(id);
    if (out.length >= MAX_PRESENCE_WATCH) break;
  }
  return out;
}

/** Only peers the viewer may message / already has history with (blocks world enumeration). */
async function filterPresencePeers(viewerId: number, ids: number[]): Promise<number[]> {
  if (!ids.length) return [];
  const map = await getMessageAccessMap(viewerId, ids);
  return ids.filter((id) => {
    if (id === viewerId) return true;
    const access = map.get(id);
    return !!(access && (access.allowed || access.canViewHistory));
  });
}

function extractSocketToken(socket: import("socket.io").Socket): string | undefined {
  const authHeader = socket.handshake.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim() || undefined;
  }
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === "string" && authToken.trim()) {
    return authToken.trim();
  }
  const allowQuery =
    (process.env.ALLOW_SOCKET_QUERY_TOKEN ?? "true").trim().toLowerCase() !== "false";
  const queryToken = socket.handshake.query?.token;
  const fromQuery =
    typeof queryToken === "string"
      ? queryToken.trim()
      : Array.isArray(queryToken) && typeof queryToken[0] === "string"
        ? queryToken[0].trim()
        : "";
  if (fromQuery) {
    if (!allowQuery) {
      logSecurityEvent("socket_query_token", { note: "rejected_ALLOW_SOCKET_QUERY_TOKEN_false" });
      return undefined;
    }
    logSecurityEvent("socket_query_token", { note: "deprecated_query_jwt" });
    return fromQuery;
  }
  return undefined;
}

export async function initSocket(httpServer: HttpServer): Promise<Server> {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, cb) => {
        if (isAllowedOrigin(origin)) cb(null, true);
        else cb(new Error("CORS blocked"), false);
      },
      credentials: true
    },
    pingInterval: 25_000,
    pingTimeout: 20_000
  });

  if (isRedisConfigured()) {
    try {
      const clients = await getSocketAdapterClients();
      if (clients) {
        io.adapter(createAdapter(clients.pubClient, clients.subClient));
        console.log(
          `[socket] Redis adapter enabled (presence server=${getPresenceServerId()})`
        );
      }
    } catch (err) {
      console.error(
        "[socket] Redis adapter failed — falling back to in-memory (single-instance only):",
        err instanceof Error ? err.message : err
      );
    }
  } else {
    console.log("[socket] REDIS_URL not set — in-memory adapter (single API instance only)");
  }
  markRedisInitAttempted();

  setIo(io);

  io.use(async (socket, next) => {
    try {
      // Prefer Authorization header, then auth.token (mobile), then query (legacy).
      const token = extractSocketToken(socket);

      if (!token) return next(new Error("Unauthorized"));
      const payload = verifyAccessToken(token) as { userId: number; iat?: number };
      const { isAccessTokenActive } = await import("../utils/tokenRevocation");
      if (!(await isAccessTokenActive(payload.userId, payload.iat))) {
        return next(new Error("Unauthorized"));
      }
      const user = await User.findByPk(payload.userId, {
        attributes: ["id", "status", "community"]
      });
      if (!user || user.status !== "APPROVED") return next(new Error("Unauthorized"));

      (socket.data as AuthedSocketData).userId = user.id;
      (socket.data as AuthedSocketData & { community?: string | null }).community =
        user.community ?? null;
      return next();
    } catch {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    void handleConnection(io, socket);
  });

  const prune = setInterval(() => {
    void pruneLastSeen(LAST_SEEN_RETENTION_MS);
  }, LAST_SEEN_PRUNE_INTERVAL_MS);
  prune.unref?.();

  if (usesRedisPresence()) {
    const hb = setInterval(() => {
      void touchPresenceServerHeartbeat();
    }, PRESENCE_HB_INTERVAL_MS);
    hb.unref?.();

    const reconcile = setInterval(() => {
      void reconcileDeadPresenceServers().then((n) => {
        if (n > 0) console.warn(`[presence] cleaned ${n} socket ref(s) from dead servers`);
      });
    }, PRESENCE_RECONCILE_INTERVAL_MS);
    reconcile.unref?.();

    void touchPresenceServerHeartbeat();
  }

  return io;
}

async function handleConnection(io: Server, socket: import("socket.io").Socket): Promise<void> {
  const userId = (socket.data as AuthedSocketData).userId;

  const watched = new Set<number>();
  const typingPeers = new Set<number>();
  let lastTypingAt = 0;

  const { becameOnline } = await presenceAdd(socket.id, userId);
  void socket.join(userRoom(userId));
  const community =
    (socket.data as AuthedSocketData & { community?: string | null }).community ?? null;
  void socket.join(communityRoom(community));

  // Never dump the full online set — clients subscribe to peers they can chat with.
  socket.emit("presence:snapshot", await buildPresenceSnapshotFor([]));

  if (becameOnline) {
    chatLog("user online", userId);
    broadcastPresence(io, userId, true, null);
  }

  socket.on("presence:request", (payload?: { userIds?: number[] }) => {
    void (async () => {
      const requested = normalizeUserIds(payload?.userIds);
      const ids =
        requested.length > 0
          ? await filterPresencePeers(userId, requested)
          : await filterPresencePeers(userId, Array.from(watched));
      socket.emit("presence:snapshot", await buildPresenceSnapshotFor(ids));
    })();
  });

  socket.on("presence:subscribe", (payload?: { userIds?: number[] }) => {
    void (async () => {
      const allowed = await filterPresencePeers(userId, normalizeUserIds(payload?.userIds));
      const next = new Set(allowed);

      for (const previous of watched) {
        if (!next.has(previous)) {
          void socket.leave(presenceRoom(previous));
        }
      }
      for (const id of next) {
        if (!watched.has(id)) {
          void socket.join(presenceRoom(id));
        }
      }

      watched.clear();
      for (const id of next) watched.add(id);

      socket.emit("presence:snapshot", await buildPresenceSnapshotFor(next));
    })();
  });

  socket.on("typing", (payload: { toUserId: number; typing: boolean }) => {
    void (async () => {
      const toUserId = Number(payload?.toUserId);
      if (!toUserId || toUserId === userId) return;

      const access = await getMessageAccess(userId, toUserId);
      if (!access.allowed && !access.canViewHistory) return;

      const typing = !!payload?.typing;
      const now = Date.now();
      if (typing && now - lastTypingAt < TYPING_MIN_INTERVAL_MS) return;
      lastTypingAt = now;

      if (typing) typingPeers.add(toUserId);
      else typingPeers.delete(toUserId);

      io.to(userRoom(toUserId)).emit("typing", {
        fromUserId: userId,
        typing
      });
    })();
  });

  socket.on(
    "message:send",
    async (
      payload: { recipientId: number; body: string; clientId?: string },
      cb?: (resp: {
        ok: boolean;
        messageId?: number;
        message?: unknown;
        error?: string;
      }) => void
    ) => {
      try {
        const recipientId = Number(payload?.recipientId);
        const body = (payload?.body ?? "").trim();
        const clientId = (payload?.clientId ?? "").trim() || null;

        if (!recipientId || recipientId === userId) {
          cb?.({ ok: false, error: "Invalid recipient" });
          return;
        }
        if (!body) {
          cb?.({ ok: false, error: "Message cannot be empty" });
          return;
        }
        if (body.length > 5000) {
          cb?.({ ok: false, error: "Message is too long" });
          return;
        }
        const { messagesService } = await import("../services/Messages.service");
        const dto = await messagesService.sendMessage(
          userId,
          recipientId,
          body,
          clientId ?? undefined
        );
        chatLog("message:send ok", dto.id, "→", recipientId);
        cb?.({ ok: true, messageId: dto.id, message: dto });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to send";
        chatLog("message:send fail", message);
        cb?.({ ok: false, error: message });
      }
    }
  );

  socket.on(
    "message:delivered",
    async (payload: { messageId: number }, cb?: (resp: { ok: boolean }) => void) => {
      try {
        const messageId = Number(payload?.messageId);
        if (!messageId) return cb?.({ ok: false });

        const msg = await Message.findByPk(messageId);
        if (!msg) return cb?.({ ok: false });
        if (msg.recipientId !== userId) return cb?.({ ok: false });

        cancelMessagePush(messageId);

        if (!(msg as any).deliveredAt) {
          (msg as any).deliveredAt = new Date();
          await msg.save();
        }

        const deliveredAt = (msg as any).deliveredAt.toISOString();
        chatLog("message:delivered", messageId, "by", userId);
        io.to(userRoom(msg.senderId)).emit("message:delivered", {
          messageId: msg.id,
          deliveredAt
        });

        cb?.({ ok: true });
      } catch {
        cb?.({ ok: false });
      }
    }
  );

  socket.on(
    "message:read",
    async (
      payload: { withUserId: number },
      cb?: (resp: { ok: boolean; readAt?: string }) => void
    ) => {
      try {
        const withUserId = Number(payload?.withUserId);
        if (!withUserId || withUserId === userId) return cb?.({ ok: false });

        const { messagesService } = await import("../services/Messages.service");
        const { readAt } = await messagesService.markRead(userId, withUserId);
        cb?.({ ok: true, readAt });
      } catch {
        cb?.({ ok: false });
      }
    }
  );

  socket.on("disconnect", () => {
    void (async () => {
      for (const peerId of typingPeers) {
        io.to(userRoom(peerId)).emit("typing", { fromUserId: userId, typing: false });
      }
      typingPeers.clear();
      watched.clear();

      const { userId: removedUserId, becameOffline, lastSeenAt } = await presenceRemove(
        socket.id
      );
      if (removedUserId && becameOffline) {
        chatLog("user offline", removedUserId);
        if (lastSeenAt) {
          void import("../services/LastSeen.service")
            .then(({ persistLastSeenAt }) =>
              persistLastSeenAt(removedUserId, new Date(lastSeenAt))
            )
            .catch(() => {});
        }
        broadcastPresence(io, removedUserId, false, lastSeenAt);
      }
    })();
  });
}

function broadcastPresence(
  io: Server,
  userId: number,
  online: boolean,
  lastSeenAt: string | null
): void {
  io.to([presenceRoom(userId), userRoom(userId)]).emit("presence:update", {
    userId,
    online,
    lastSeenAt
  });
}

/** Graceful shutdown hook — clear this instance's presence keys + Redis clients. */
export async function shutdownRealtime(): Promise<void> {
  await clearLocalPresenceFromRedis();
  await closeRedis();
}
