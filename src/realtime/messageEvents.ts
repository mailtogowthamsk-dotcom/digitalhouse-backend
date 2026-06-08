import { getIo } from "./io";

export type MessageEventDto = {
  id: number;
  senderId: number;
  recipientId: number;
  body: string;
  clientId: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
};

/** Push a persisted message to connected clients (socket send + REST send). */
export function emitMessageEvents(dto: MessageEventDto): void {
  const io = getIo();
  if (!io) return;
  io.to(`user:${dto.recipientId}`).emit("message:new", dto);
  io.to(`user:${dto.senderId}`).emit("message:sent", dto);
}
