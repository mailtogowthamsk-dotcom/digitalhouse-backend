/**
 * Delivery-aware push notifications for chat messages.
 *
 * `isOnline()` only reflects whether a socket is registered, not whether the
 * device actually received anything. Socket.IO evicts a dead socket after
 * pingInterval + pingTimeout, so a backgrounded or network-switched phone stays
 * "online" for up to ~45s. Suppressing the push on that flag alone means the
 * message reaches neither the socket nor the notification tray.
 *
 * Instead we defer the push for recipients that look online and cancel it when
 * the device acknowledges delivery. No ack inside the window means the socket
 * was stale, so the push goes out.
 */

import { isOnline } from "./presence";

type PendingPush = {
  timer: NodeJS.Timeout;
  recipientId: number;
};

/** Grace period for a live device to ack `message:new` before we fall back to push. */
const DELIVERY_GRACE_MS = Number(process.env.CHAT_PUSH_GRACE_MS) || 6_000;

/** Safety valve: never hold more than this many deferred pushes in memory. */
const MAX_PENDING = 5_000;

const pending = new Map<number, PendingPush>();

function clearPending(messageId: number): PendingPush | undefined {
  const entry = pending.get(messageId);
  if (entry) {
    clearTimeout(entry.timer);
    pending.delete(messageId);
  }
  return entry;
}

export type MessagePushJob = {
  messageId: number;
  recipientId: number;
  senderId: number;
  body: string;
};

/**
 * Send the "new message" push now when the recipient has no live socket,
 * otherwise hold it until the delivery grace period expires.
 */
export function scheduleMessagePush(job: MessagePushJob): void {
  const { messageId, recipientId, senderId, body } = job;
  if (!messageId || !recipientId || !senderId) return;

  clearPending(messageId);

  if (!isOnline(recipientId) || pending.size >= MAX_PENDING) {
    void sendMessagePush(recipientId, senderId, body);
    return;
  }

  const timer = setTimeout(() => {
    pending.delete(messageId);
    void sendMessagePush(recipientId, senderId, body);
  }, DELIVERY_GRACE_MS);

  // Never keep the process alive just to flush a notification.
  timer.unref?.();
  pending.set(messageId, { timer, recipientId });
}

/** The recipient device confirmed delivery — the push is no longer needed. */
export function cancelMessagePush(messageId: number): void {
  clearPending(Number(messageId));
}

async function sendMessagePush(
  recipientId: number,
  senderId: number,
  body: string
): Promise<void> {
  try {
    const NotificationService = await import("../services/Notification.service");
    await NotificationService.notifyNewMessage(recipientId, senderId, body);
  } catch {
    // Push delivery is best-effort; the message itself is already persisted.
  }
}

/** Test/shutdown helper — drops every deferred push without sending. */
export function resetMessagePushQueue(): void {
  for (const messageId of Array.from(pending.keys())) {
    clearPending(messageId);
  }
}
