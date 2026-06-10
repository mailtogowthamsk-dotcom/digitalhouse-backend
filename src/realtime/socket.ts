import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { verifyAccessToken } from "../utils/jwt.util";
import { User } from "../models";
import { Message } from "../models";
import { presenceAdd, presenceRemove } from "./presence";
import { setIo, communityRoom } from "./io";

type AuthedSocketData = { userId: number };

export function initSocket(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true }
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

    presenceAdd(socket.id, userId);
    socket.join(`user:${userId}`);
    const community = (socket.data as AuthedSocketData & { community?: string | null }).community ?? null;
    socket.join(communityRoom(community));

    io.emit("presence:update", { userId, online: true });

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
        cb?: (resp: { ok: boolean; messageId?: number; error?: string }) => void
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
          cb?.({ ok: true, messageId: dto.id });
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : "Failed to send";
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

          io.to(`user:${msg.senderId}`).emit("message:delivered", {
            messageId: msg.id,
            deliveredAt: (msg as any).deliveredAt.toISOString()
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

          const now = new Date();
          await Message.update(
            { readAt: now } as any,
            { where: { senderId: withUserId, recipientId: userId, readAt: null } }
          );

          io.to(`user:${withUserId}`).emit("message:read", {
            withUserId: userId,
            readAt: now.toISOString()
          });

          cb?.({ ok: true, readAt: now.toISOString() });
        } catch {
          cb?.({ ok: false });
        }
      }
    );

    socket.on("disconnect", () => {
      const { userId: removedUserId, becameOffline } = presenceRemove(socket.id);
      if (removedUserId && becameOffline) {
        io.emit("presence:update", { userId: removedUserId, online: false });
      }
    });
  });

  return io;
}

