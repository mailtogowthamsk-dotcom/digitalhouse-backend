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
