import { getIo } from "./io";

export type MessageEventDto = {
  id: number;
  senderId: number;
  recipientId: number;
  body: string;
  sharedPostId?: number | null;
  clientId: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
};

const isDev = process.env.NODE_ENV !== "production";

function chatLog(...args: unknown[]) {
  if (isDev) console.log("[realtime]", ...args);
}

/** Push a persisted message to connected clients (socket send + REST send). */
export function emitMessageEvents(dto: MessageEventDto): void {
  const io = getIo();
  if (!io) return;

  chatLog("message:emit", {
    id: dto.id,
    senderId: dto.senderId,
    recipientId: dto.recipientId,
    deliveredAt: dto.deliveredAt
  });

  io.to(`user:${dto.recipientId}`).emit("message:new", dto);
  io.to(`user:${dto.senderId}`).emit("message:sent", dto);

  // Auto-delivered at persist time (recipient online) — notify sender explicitly
  // so clients don't depend only on the message:sent payload shape.
  if (dto.deliveredAt) {
    io.to(`user:${dto.senderId}`).emit("message:delivered", {
      messageId: dto.id,
      deliveredAt: dto.deliveredAt
    });
  }
}

export function emitMessageRead(readerId: number, withUserId: number, readAt: string): void {
  const io = getIo();
  if (!io) return;
  chatLog("message:read", { readerId, withUserId, readAt });
  io.to(`user:${withUserId}`).emit("message:read", {
    withUserId: readerId,
    readAt
  });
}
