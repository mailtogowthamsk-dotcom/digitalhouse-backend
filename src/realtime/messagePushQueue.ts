/**
 * Delivery-aware push notifications for chat messages.
 *
 * Deferred pushes are coordinated via Redis when available so any API instance
 * can cancel a pending push after the device acks delivery.
 */

import { isOnline } from "./presence";
import { getRedis, isRedisConfigured, redisKey } from "../config/redis";

type PendingPush = {
  timer: NodeJS.Timeout;
  recipientId: number;
};

const DELIVERY_GRACE_MS = Number(process.env.CHAT_PUSH_GRACE_MS) || 6_000;
const MAX_PENDING = 5_000;

const pending = new Map<number, PendingPush>();

function pendingKey(messageId: number): string {
  return redisKey(["chat", "push", "pending", String(messageId)]);
}

function clearLocalPending(messageId: number): PendingPush | undefined {
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

async function markPendingInRedis(job: MessagePushJob): Promise<void> {
  if (!isRedisConfigured()) return;
  const redis = getRedis();
  if (!redis) return;
  const ttlSec = Math.max(2, Math.ceil((DELIVERY_GRACE_MS + 2000) / 1000));
  await redis.set(
    pendingKey(job.messageId),
    JSON.stringify({
      recipientId: job.recipientId,
      senderId: job.senderId,
      body: job.body
    }),
    "EX",
    ttlSec
  );
}

async function clearPendingInRedis(messageId: number): Promise<boolean> {
  if (!isRedisConfigured()) return false;
  const redis = getRedis();
  if (!redis) return false;
  const n = await redis.del(pendingKey(messageId));
  return n > 0;
}

async function stillPendingInRedis(messageId: number): Promise<boolean> {
  if (!isRedisConfigured()) return pending.has(messageId);
  const redis = getRedis();
  if (!redis) return pending.has(messageId);
  return (await redis.exists(pendingKey(messageId))) === 1;
}

/**
 * Send the "new message" push now when the recipient has no live socket,
 * otherwise hold it until the delivery grace period expires.
 */
export function scheduleMessagePush(job: MessagePushJob): void {
  void scheduleMessagePushAsync(job);
}

async function scheduleMessagePushAsync(job: MessagePushJob): Promise<void> {
  const { messageId, recipientId, senderId, body } = job;
  if (!messageId || !recipientId || !senderId) return;

  clearLocalPending(messageId);
  await clearPendingInRedis(messageId).catch(() => undefined);

  const online = await isOnline(recipientId).catch(() => false);
  if (!online || pending.size >= MAX_PENDING) {
    void sendMessagePush(recipientId, senderId, body);
    return;
  }

  await markPendingInRedis(job).catch(() => undefined);

  const timer = setTimeout(() => {
    pending.delete(messageId);
    void (async () => {
      const still = await stillPendingInRedis(messageId).catch(() => false);
      if (!still) return;
      await clearPendingInRedis(messageId).catch(() => undefined);
      await sendMessagePush(recipientId, senderId, body);
    })();
  }, DELIVERY_GRACE_MS);

  timer.unref?.();
  pending.set(messageId, { timer, recipientId });
}

/** The recipient device confirmed delivery — the push is no longer needed. */
export function cancelMessagePush(messageId: number): void {
  const id = Number(messageId);
  clearLocalPending(id);
  void clearPendingInRedis(id).catch(() => undefined);
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
    clearLocalPending(messageId);
  }
}
