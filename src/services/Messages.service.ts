import { Op, QueryTypes } from "sequelize";
import { sequelize } from "../config/db";
import { Message, User } from "../models";
import { toSignedUrlIfR2 } from "../utils/r2Client";
import { isOnline } from "../realtime/presence";
import { emitMessageEvents, emitMessageRead } from "../realtime/messageEvents";
import * as NotificationService from "./Notification.service";
import { getBlockedUserIds } from "./MatrimonySafety.service";
import {
  assertCanSendMessage,
  assertCanViewHistory,
  getMessageAccess,
  getMessageAccessMap,
  type ChatLane,
  type MessageAccessDto
} from "./MessagePermission.service";
import {
  getArchivedThreadUserIds,
  getLeftThreadUserIds,
  getThreadPreferencesMap
} from "./ThreadPreference.service";

export type ThreadDto = {
  otherUser: { id: number; name: string; profileImage: string | null; online: boolean };
  chatLanes: ChatLane[];
  primaryLane: ChatLane | null;
  muted: boolean;
  archived: boolean;
  lastMessage: {
    id: number;
    senderId: number;
    recipientId: number;
    body: string;
    createdAt: string;
    deliveredAt: string | null;
    readAt: string | null;
  } | null;
  unreadCount: number;
};

export type MessageDto = {
  id: number;
  senderId: number;
  recipientId: number;
  body: string;
  sharedPostId: number | null;
  clientId: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
};

function toMessageDto(m: Message): MessageDto {
  return {
    id: m.id,
    senderId: m.senderId,
    recipientId: m.recipientId,
    body: m.body,
    sharedPostId: (m as any).sharedPostId ?? null,
    clientId: (m as any).clientId ?? null,
    deliveredAt: (m as any).deliveredAt ? (m as any).deliveredAt.toISOString() : null,
    readAt: m.readAt ? m.readAt.toISOString() : null,
    createdAt: m.createdAt.toISOString()
  };
}

export async function listThreads(
  userId: number,
  opts?: { includeArchived?: boolean; archivedOnly?: boolean }
): Promise<ThreadDto[]> {
  const rows = await sequelize.query<
    { otherUserId: number; lastMessageId: number; unreadCount: number }[]
  >(
    `
    SELECT
      IF(senderId = :me, recipientId, senderId) AS otherUserId,
      MAX(id) AS lastMessageId,
      SUM(CASE WHEN recipientId = :me AND readAt IS NULL THEN 1 ELSE 0 END) AS unreadCount
    FROM messages
    WHERE senderId = :me OR recipientId = :me
    GROUP BY otherUserId
    ORDER BY MAX(createdAt) DESC
    `,
    { type: QueryTypes.SELECT, replacements: { me: userId } }
  );

  if (rows.length === 0) return [];

  const blockedIds = await getBlockedUserIds(userId);

  const otherUserIds = rows
    .map((r) => Number((r as any).otherUserId))
    .filter((id) => !blockedIds.has(id));
  if (otherUserIds.length === 0) return [];

  const filteredRows = rows.filter((r) => !blockedIds.has(Number((r as any).otherUserId)));
  const lastMessageIds = filteredRows.map((r) => Number((r as any).lastMessageId));

  const [users, lastMessages] = await Promise.all([
    User.findAll({ where: { id: { [Op.in]: otherUserIds } }, attributes: ["id", "fullName", "profilePhoto"] }),
    Message.findAll({ where: { id: { [Op.in]: lastMessageIds } } })
  ]);

  const usersById = new Map<number, User>(users.map((u) => [u.id, u]));
  const lastById = new Map<number, Message>(lastMessages.map((m) => [m.id, m]));
  const accessMap = await getMessageAccessMap(userId, otherUserIds);
  const leftIds = await getLeftThreadUserIds(userId);
  const archivedIds = await getArchivedThreadUserIds(userId);
  const prefMap = await getThreadPreferencesMap(userId, otherUserIds);
  const includeArchived = opts?.includeArchived === true;
  const archivedOnly = opts?.archivedOnly === true;

  const threads = await Promise.all(
    filteredRows.map(async (r) => {
      const otherUserId = Number((r as any).otherUserId);
      if (leftIds.has(otherUserId)) return null;
      const pref = prefMap.get(otherUserId);
      const isArchived = pref?.archived ?? archivedIds.has(otherUserId);
      if (archivedOnly) {
        if (!isArchived) return null;
      } else if (isArchived && !includeArchived) {
        return null;
      }
      const unreadCount = Number((r as any).unreadCount ?? 0);
      const u = usersById.get(otherUserId);
      const lm = lastById.get(Number((r as any).lastMessageId)) ?? null;
      const access = accessMap.get(otherUserId);

      const profileImage =
        u?.profilePhoto ? (await toSignedUrlIfR2(u.profilePhoto)) ?? u.profilePhoto : null;

      return {
        otherUser: {
          id: otherUserId,
          name: u?.fullName ?? "Unknown",
          profileImage,
          online: isOnline(otherUserId)
        },
        chatLanes: access?.chatLanes ?? [],
        primaryLane: access?.primaryLane ?? null,
        muted: pref?.muted ?? false,
        archived: isArchived,
        lastMessage: lm
          ? {
              id: lm.id,
              senderId: lm.senderId,
              recipientId: lm.recipientId,
              body: lm.body,
              createdAt: lm.createdAt.toISOString(),
              deliveredAt: (lm as any).deliveredAt ? (lm as any).deliveredAt.toISOString() : null,
              readAt: lm.readAt ? lm.readAt.toISOString() : null
            }
          : null,
        unreadCount
      } satisfies ThreadDto;
    })
  );

  return threads.filter((t): t is ThreadDto => t != null);
}

export async function getHistory(
  me: number,
  otherUserId: number,
  limit: number,
  cursorId?: number
): Promise<{ messages: MessageDto[]; nextCursorId: number | null }> {
  await assertCanViewHistory(me, otherUserId);

  const where: any = {
    [Op.or]: [
      { senderId: me, recipientId: otherUserId },
      { senderId: otherUserId, recipientId: me }
    ]
  };

  if (cursorId) where.id = { [Op.lt]: cursorId };

  const rows = await Message.findAll({
    where,
    order: [["id", "DESC"]],
    limit
  });

  const messages = rows.reverse().map(toMessageDto);
  const nextCursorId = rows.length === limit ? rows[rows.length - 1].id : null;
  return { messages, nextCursorId };
}

export async function sendMessage(
  senderId: number,
  recipientId: number,
  body: string,
  clientId?: string
): Promise<MessageDto> {
  const recipient = await User.findByPk(recipientId, { attributes: ["id", "status"] });
  if (!recipient || recipient.status !== "APPROVED") throw new Error("Recipient not found");
  if (recipientId === senderId) throw new Error("Invalid recipient");

  await assertCanSendMessage(senderId, recipientId);

  const trimmed = body.trim();
  const msg = await Message.create({
    senderId,
    recipientId,
    body: trimmed,
    clientId: (clientId ?? "").trim() || null,
    deliveredAt: isOnline(recipientId) ? new Date() : null,
    readAt: null
  } as any);

  const dto = toMessageDto(msg);
  emitMessageEvents(dto);

  if (!isOnline(recipientId)) {
    void NotificationService.notifyNewMessage(recipientId, senderId, trimmed).catch(() => {});
  }

  return dto;
}

export async function markRead(me: number, otherUserId: number): Promise<{ readAt: string }> {
  const now = new Date();
  const [updated] = await Message.update(
    { readAt: now } as any,
    { where: { senderId: otherUserId, recipientId: me, readAt: null } }
  );
  const readAt = now.toISOString();
  // Notify sender even when client used REST (or when socket:read delegates here).
  if (updated > 0) {
    emitMessageRead(me, otherUserId, readAt);
  }
  return { readAt };
}

export async function unreadCount(me: number): Promise<number> {
  return Message.count({ where: { recipientId: me, readAt: null } });
}

export async function messageAccess(
  me: number,
  otherUserId: number
): Promise<MessageAccessDto> {
  return getMessageAccess(me, otherUserId);
}

export async function updateThreadPreference(
  me: number,
  otherUserId: number,
  patch: { muted?: boolean; archived?: boolean; left?: boolean }
) {
  const { updateThreadPreference: updatePref } = await import("./ThreadPreference.service");
  return updatePref(me, otherUserId, patch);
}

export const messagesService = {
  listThreads,
  getHistory,
  sendMessage,
  markRead,
  unreadCount,
  messageAccess,
  updateThreadPreference
};

