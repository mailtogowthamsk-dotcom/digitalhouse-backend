import type { Server } from "socket.io";

let ioInstance: Server | null = null;

export function setIo(io: Server): void {
  ioInstance = io;
}

export function getIo(): Server | null {
  return ioInstance;
}

/** Room for community-scoped feed realtime (community string or "__null__"). */
export function communityRoom(community: string | null): string {
  return `community:${community ?? "__null__"}`;
}

/** Private room delivering a user's own events (messages, receipts, notifications). */
export function userRoom(userId: number): string {
  return `user:${userId}`;
}

/**
 * Watch room for one user's presence. Sockets join the rooms of the peers they
 * display, so an online/offline transition only reaches interested clients.
 */
export function presenceRoom(userId: number): string {
  return `presence:${userId}`;
}
