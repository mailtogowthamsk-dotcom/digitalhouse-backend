import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { verifyAccessToken } from "../utils/jwt.util";
import { User } from "../models";
import { Message } from "../models";
import { presenceAdd, presenceRemove, listOnlineUserIds } from "./presence";
import { setIo, communityRoom } from "./io";

type AuthedSocketData = { userId: number };

const isDev = process.env.NODE_ENV !== "production";

function chatLog(...args: unknown[]) {
  if (isDev) console.log("[socket]", ...args);
}

export function initSocket(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
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

    const { becameOnline } = presenceAdd(socket.id, userId);
    socket.join(`user:${userId}`);
    const community = (socket.data as AuthedSocketData & { community?: string | null }).community ?? null;
    socket.join(communityRoom(community));

    // Snapshot so reconnecting clients sync presence without waiting for transitions.
    socket.emit("presence:snapshot", { onlineUserIds: listOnlineUserIds() });

    if (becameOnline) {
      chatLog("user online", userId);
      io.emit("presence:update", { userId, online: true });
    }

    socket.on("typing", (payload: { toUserId: number; typing: boolean }) => {
      if (!payload?.toUserId || payload.toUserId === userId) return;
      io.to(`user:${payload.toUserId}`).emit("typing", {
        fromUserId: userId,
        typing: !!payload.typing
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

          if (!(msg as any).deliveredAt) {
            (msg as any).deliveredAt = new Date();
            await msg.save();
          }

          const deliveredAt = (msg as any).deliveredAt.toISOString();
          chatLog("message:delivered", messageId, "by", userId);
          io.to(`user:${msg.senderId}`).emit("message:delivered", {
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
      const { userId: removedUserId, becameOffline } = presenceRemove(socket.id);
      if (removedUserId && becameOffline) {
        chatLog("user offline", removedUserId);
        io.emit("presence:update", { userId: removedUserId, online: false });
      }
    });
  });

  return io;
}
