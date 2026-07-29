import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { verifyAccessToken } from "../utils/jwt.util";
import { User } from "../models";
import { Message } from "../models";
import {
  presenceAdd,
  presenceRemove,
  buildPresenceSnapshot,
  buildPresenceSnapshotFor,
  pruneLastSeen
} from "./presence";
import { setIo, communityRoom, userRoom, presenceRoom } from "./io";
import { cancelMessagePush } from "./messagePushQueue";
import { isAllowedOrigin } from "../config/cors";

type AuthedSocketData = { userId: number };

const isDev = process.env.NODE_ENV !== "production";

/** Upper bound on peers one client may watch, so a socket cannot join unbounded rooms. */
const MAX_PRESENCE_WATCH = 300;

/** Minimum gap between relayed typing events from one socket. */
const TYPING_MIN_INTERVAL_MS = 400;

/** Last-seen entries older than this are dropped from memory. */
const LAST_SEEN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const LAST_SEEN_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

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

export function initSocket(httpServer: HttpServer) {
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
  setIo(io);

  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (typeof socket.handshake.headers.authorization === "string" &&
        socket.handshake.headers.authorization.startsWith("Bearer ")
          ? socket.handshake.headers.authorization.slice(7)
          : undefined) ??
        (socket.handshake.query?.token as string | undefined);

      if (!token) return next(new Error("Unauthorized"));
      const payload = verifyAccessToken(token) as { userId: number };
      const user = await User.findByPk(payload.userId, { attributes: ["id", "status", "community"] });
      if (!user || user.status !== "APPROVED") return next(new Error("Unauthorized"));

      (socket.data as AuthedSocketData).userId = user.id;
      (socket.data as AuthedSocketData & { community?: string | null }).community = user.community ?? null;
      return next();
    } catch {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const userId = (socket.data as AuthedSocketData).userId;

    /** Peers whose presence this socket renders — drives targeted transitions. */
    const watched = new Set<number>();
    /** Peers this socket last told we were typing to, so we can retract on drop. */
    const typingPeers = new Set<number>();
    let lastTypingAt = 0;

    const { becameOnline } = presenceAdd(socket.id, userId);
    socket.join(userRoom(userId));
    const community = (socket.data as AuthedSocketData & { community?: string | null }).community ?? null;
    socket.join(communityRoom(community));

    // Snapshot so reconnecting clients sync presence without waiting for transitions.
    socket.emit("presence:snapshot", buildPresenceSnapshot());

    if (becameOnline) {
      chatLog("user online", userId);
      broadcastPresence(io, userId, true, null);
    }

    /** Client re-requests after attaching listeners (fixes connect race). */
    socket.on("presence:request", (payload?: { userIds?: number[] }) => {
      const ids = normalizeUserIds(payload?.userIds);
      socket.emit(
        "presence:snapshot",
        ids.length > 0 ? buildPresenceSnapshotFor(ids) : buildPresenceSnapshot()
      );
    });

    /**
     * Declare which peers this client displays. Replaces the previous watch set
     * so long-lived sessions do not accumulate rooms, then answers with a
     * snapshot scoped to exactly those peers.
     */
    socket.on("presence:subscribe", (payload?: { userIds?: number[] }) => {
      const ids = normalizeUserIds(payload?.userIds);
      const next = new Set(ids);

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

      socket.emit("presence:snapshot", buildPresenceSnapshotFor(next));
    });

    socket.on("typing", (payload: { toUserId: number; typing: boolean }) => {
      const toUserId = Number(payload?.toUserId);
      if (!toUserId || toUserId === userId) return;

      const typing = !!payload?.typing;
      const now = Date.now();
      // Throttle keep-alives, but never drop the retraction the peer waits for.
      if (typing && now - lastTypingAt < TYPING_MIN_INTERVAL_MS) return;
      lastTypingAt = now;

      if (typing) typingPeers.add(toUserId);
      else typingPeers.delete(toUserId);

      io.to(userRoom(toUserId)).emit("typing", {
        fromUserId: userId,
        typing
      });
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
          const dto = await messagesService.sendMessage(userId, recipientId, body, clientId ?? undefined);
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

          // The device has the message — a fallback push would be a duplicate.
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
      // Retract any indicator this socket left hanging, otherwise the peer is
      // stuck on "typing…" until they leave the conversation.
      for (const peerId of typingPeers) {
        io.to(userRoom(peerId)).emit("typing", { fromUserId: userId, typing: false });
      }
      typingPeers.clear();
      watched.clear();

      const { userId: removedUserId, becameOffline, lastSeenAt } = presenceRemove(socket.id);
      if (removedUserId && becameOffline) {
        chatLog("user offline", removedUserId);
        if (lastSeenAt) {
          void import("../services/LastSeen.service")
            .then(({ persistLastSeenAt }) => persistLastSeenAt(removedUserId, new Date(lastSeenAt)))
            .catch(() => {});
        }
        broadcastPresence(io, removedUserId, false, lastSeenAt);
      }
    });
  });

  const prune = setInterval(
    () => pruneLastSeen(LAST_SEEN_RETENTION_MS),
    LAST_SEEN_PRUNE_INTERVAL_MS
  );
  prune.unref?.();

  return io;
}

/**
 * Presence transitions reach the watchers of that user plus their own devices.
 * Community rooms are the wrong scope here: a chat peer is frequently in a
 * different community, which is why status used to freeze after the first
 * snapshot.
 */
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
