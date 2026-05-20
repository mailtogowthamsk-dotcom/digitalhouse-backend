import { Notification, User } from "../models";
import { getIo } from "../realtime/io";

export type NotificationDto = {
  id: number;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
};

function emitNotificationNew(userId: number, dto: NotificationDto): void {
  getIo()?.to(`user:${userId}`).emit("notification:new", dto);
}

export async function createUserNotification(
  userId: number,
  title: string,
  body: string | null
): Promise<NotificationDto> {
  const row = await Notification.create({
    userId,
    title: title.trim(),
    body: body?.trim() || null,
    readAt: null
  } as any);

  const dto: NotificationDto = {
    id: row.id,
    title: row.title,
    body: row.body,
    readAt: null,
    createdAt: row.createdAt.toISOString()
  };
  emitNotificationNew(userId, dto);
  return dto;
}

async function senderName(userId: number): Promise<string> {
  const u = await User.findByPk(userId, { attributes: ["fullName"] });
  return u?.fullName?.trim() || "Someone";
}

export async function notifyMatrimonyInterestReceived(
  toUserId: number,
  fromUserId: number
): Promise<void> {
  const name = await senderName(fromUserId);
  await createUserNotification(
    toUserId,
    "New matrimony interest",
    `${name} sent you an interest. Open Matrimony → Interests to respond.`
  );
}

export async function notifyMatrimonyInterestAccepted(
  toUserId: number,
  fromUserId: number
): Promise<void> {
  const name = await senderName(fromUserId);
  await createUserNotification(
    toUserId,
    "Interest accepted",
    `${name} accepted your interest.`
  );
}

export async function notifyMatrimonyMatch(userId: number, otherUserId: number): Promise<void> {
  const name = await senderName(otherUserId);
  await createUserNotification(
    userId,
    "New match",
    `You matched with ${name}. Chat and horoscope sharing are now available.`
  );
}

export async function notifyHoroscopeRequest(
  toUserId: number,
  fromUserId: number
): Promise<void> {
  const name = await senderName(fromUserId);
  await createUserNotification(
    toUserId,
    "Horoscope requested",
    `${name} requested to view your horoscope. Open Matrimony → Matches to share.`
  );
}

export async function notifyHoroscopeShared(
  toUserId: number,
  fromUserId: number
): Promise<void> {
  const name = await senderName(fromUserId);
  await createUserNotification(
    toUserId,
    "Horoscope shared",
    `${name} shared their horoscope with you.`
  );
}

export async function notifyNewMessage(
  recipientId: number,
  senderId: number,
  preview: string
): Promise<void> {
  if (recipientId === senderId) return;
  const name = await senderName(senderId);
  const snippet = preview.trim().slice(0, 120);
  await createUserNotification(
    recipientId,
    `Message from ${name}`,
    snippet || "You have a new message."
  );
}

export async function listNotifications(
  userId: number,
  page = 1,
  limit = 30
): Promise<{ items: NotificationDto[]; total: number; unread: number }> {
  const safeLimit = Math.min(50, Math.max(1, limit));
  const offset = (Math.max(1, page) - 1) * safeLimit;

  const { count, rows } = await Notification.findAndCountAll({
    where: { userId },
    order: [["createdAt", "DESC"]],
    limit: safeLimit,
    offset
  });

  const unread = await Notification.count({ where: { userId, readAt: null } });

  return {
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      readAt: r.readAt ? r.readAt.toISOString() : null,
      createdAt: r.createdAt.toISOString()
    })),
    total: count,
    unread
  };
}

export async function markNotificationRead(userId: number, id: number): Promise<void> {
  const row = await Notification.findOne({ where: { id, userId } });
  if (!row || row.readAt) return;
  await row.update({ readAt: new Date() } as any);
}

export async function markAllNotificationsRead(userId: number): Promise<void> {
  await Notification.update(
    { readAt: new Date() } as any,
    { where: { userId, readAt: null } }
  );
}
