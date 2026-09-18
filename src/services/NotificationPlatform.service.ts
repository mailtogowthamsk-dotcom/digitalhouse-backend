import { Op, Transaction } from "sequelize";
import {
  Notification,
  NotificationPreference,
  PushDeviceToken,
  User
} from "../models";
import { getIo } from "../realtime/io";
import {
  CATEGORY_BY_TYPE,
  GROUPABLE_TYPES,
  MESSAGE_GROUPABLE_TYPES,
  MATRIMONY_NOTIFICATION_TYPES,
  NOTIFICATION_ACTIONS,
  NOTIFICATION_TYPES,
  PREFERENCE_KEY_BY_CATEGORY,
  type NotificationActionType,
  type NotificationCategory,
  type NotificationType
} from "../constants/notification.constants";
import { sequelize } from "../config/db";
import { toPublicUrlIfR2 } from "../utils/r2Client";
import { sendExpoPush } from "./ExpoPush.service";
import { isFcmConfigured, sendFcmPush } from "./FcmPush.service";
import { isExpoPushToken, isFcmPushToken } from "../utils/pushToken.util";

const GROUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export type NotificationDto = {
  id: number;
  type: string;
  category: NotificationCategory;
  title: string;
  body: string | null;
  image: string | null;
  actionType: string | null;
  actionTargetId: string | null;
  actorUserId: number | null;
  actorName: string | null;
  groupCount: number;
  priority: number;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};

export type UnreadCountsDto = {
  total: number;
  social: number;
  matrimony: number;
  messages: number;
  community: number;
  system: number;
};

export type DispatchInput = {
  userId: number;
  type: NotificationType;
  title: string;
  body?: string | null;
  imageUrl?: string | null;
  actionType?: NotificationActionType;
  actionTargetId?: string | number | null;
  actorUserId?: number | null;
  groupKey?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Override category (e.g. admin broadcast uses selected category) */
  category?: NotificationCategory;
  /** Skip preference check (critical system) */
  force?: boolean;
};

function emitRealtime(userId: number, payload: { notification: NotificationDto; counts: UnreadCountsDto }) {
  getIo()?.to(`user:${userId}`).emit("notification:new", payload);
  getIo()?.to(`user:${userId}`).emit("notification:counts", payload.counts);
}

async function actorProfile(userId: number | null | undefined): Promise<{
  name: string | null;
  image: string | null;
}> {
  if (!userId) return { name: null, image: null };
  const u = await User.findByPk(userId, { attributes: ["fullName", "profilePhoto"] });
  const raw = u?.profilePhoto ?? null;
  const image = raw ? (await toPublicUrlIfR2(raw)) ?? raw : null;
  return { name: u?.fullName?.trim() || null, image };
}

export async function ensurePreferences(userId: number): Promise<NotificationPreference> {
  const [row] = await NotificationPreference.findOrCreate({
    where: { userId },
    defaults: { userId } as any
  });
  return row;
}

export async function isCategoryEnabled(
  userId: number,
  category: NotificationCategory
): Promise<boolean> {
  const prefs = await ensurePreferences(userId);
  const key = PREFERENCE_KEY_BY_CATEGORY[category] as keyof NotificationPreference;
  return !!(prefs as any)[key];
}

function groupTitle(type: NotificationType, count: number, sampleName: string): string {
  if (type === NOTIFICATION_TYPES.POST_LIKE) {
    return count === 1 ? `${sampleName} liked your post` : `${count} people liked your post`;
  }
  if (type === NOTIFICATION_TYPES.POST_COMMENT) {
    return count === 1 ? `${sampleName} commented on your post` : `${count} new comments on your post`;
  }
  if (type === NOTIFICATION_TYPES.COMMENT_REPLY) {
    return count === 1 ? `${sampleName} replied to your comment` : `${count} replies on your comment`;
  }
  if (type === NOTIFICATION_TYPES.MATRIMONY_PROFILE_VIEWED) {
    return count === 1 ? `${sampleName} viewed your profile` : `${count} people viewed your profile`;
  }
  if (MESSAGE_GROUPABLE_TYPES.has(type)) {
    // Keep stable title; count is shown via groupCount / body summary on the client.
    return `Message from ${sampleName}`;
  }
  return count > 1 ? `${count} notifications` : sampleName;
}

export async function toNotificationDto(row: Notification): Promise<NotificationDto> {
  const actor = await actorProfile(row.actorUserId);
  return {
    id: row.id,
    type: row.type,
    category: row.category as NotificationCategory,
    title: row.title,
    body: row.body,
    image: row.imageUrl ?? actor.image,
    actionType: row.actionType,
    actionTargetId: row.actionTargetId,
    actorUserId: row.actorUserId,
    actorName: actor.name,
    groupCount: row.groupCount ?? 1,
    priority: row.priority ?? 0,
    isRead: !!row.readAt,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString()
  };
}

export async function getUnreadCounts(userId: number): Promise<UnreadCountsDto> {
  const base = { userId, readAt: null, deletedAt: null };
  const [total, social, matrimony, messages, community, system] = await Promise.all([
    Notification.count({ where: base }),
    Notification.count({ where: { ...base, category: "SOCIAL" } }),
    Notification.count({ where: { ...base, category: "MATRIMONY" } }),
    Notification.count({ where: { ...base, category: "MESSAGES" } }),
    Notification.count({ where: { ...base, category: "COMMUNITY" } }),
    Notification.count({ where: { ...base, category: "SYSTEM" } })
  ]);
  return { total, social, matrimony, messages, community, system };
}

/**
 * Soft-delete other unread DM Activity rows for the same peer and keep a single
 * card with an accurate group_count. Heals null group_key legacy rows + insert races.
 */
async function collapseUnreadMessageDuplicates(
  userId: number,
  actorUserId: number,
  type: NotificationType,
  keepId: number,
  groupKey: string
): Promise<Notification> {
  const siblings = await Notification.findAll({
    where: {
      userId,
      type,
      actorUserId,
      readAt: null,
      deletedAt: null,
      id: { [Op.ne]: keepId }
    },
    attributes: ["id", "groupCount"]
  });

  if (!siblings.length) {
    const keep = await Notification.findByPk(keepId);
    if (keep && keep.groupKey !== groupKey) {
      await keep.update({ groupKey } as any);
    }
    return keep ?? ((await Notification.findByPk(keepId)) as Notification);
  }

  const extraCount = siblings.reduce((sum, s) => sum + (s.groupCount ?? 1), 0);
  const now = new Date();
  await Notification.update(
    { deletedAt: now } as any,
    {
      where: {
        id: { [Op.in]: siblings.map((s) => s.id) },
        deletedAt: null
      }
    }
  );

  const keep = await Notification.findByPk(keepId);
  if (!keep) {
    throw new Error("notification keeper missing after collapse");
  }
  const nextCount = (keep.groupCount ?? 1) + extraCount;
  await keep.update({
    groupKey,
    groupCount: nextCount,
    metadata: {
      ...(keep.metadata && typeof keep.metadata === "object" ? keep.metadata : {}),
      messageCount: nextCount
    },
    updatedAt: now
  } as any);
  return keep;
}

/** Create or aggregate notification; returns null if suppressed by preferences */
export async function dispatchNotification(input: DispatchInput): Promise<NotificationDto | null> {
  const category = input.category ?? CATEGORY_BY_TYPE[input.type] ?? "SYSTEM";
  if (!input.force && !(await isCategoryEnabled(input.userId, category))) {
    return null;
  }

  const priority = MATRIMONY_NOTIFICATION_TYPES.has(input.type) ? 1 : 0;
  const actor = await actorProfile(input.actorUserId);
  const imageUrl = input.imageUrl ?? actor.image;
  const isMessageGroup = MESSAGE_GROUPABLE_TYPES.has(input.type);
  // Always derive a stable DM group key from the peer when callers omit it
  // (stale builds / alternate entry points must still collapse Activity cards).
  const resolvedGroupKey =
    input.groupKey ??
    (isMessageGroup && input.actorUserId != null ? `dm:${input.actorUserId}` : null);
  const canGroup = Boolean(resolvedGroupKey && GROUPABLE_TYPES.has(input.type));

  let row: Notification | null = null;
  let aggregated = false;

  if (canGroup && resolvedGroupKey) {
    const groupKey = resolvedGroupKey;
    const since = isMessageGroup ? null : new Date(Date.now() - GROUP_WINDOW_MS);

    await sequelize.transaction(async (transaction) => {
      const where: Record<string, unknown> = {
        userId: input.userId,
        groupKey,
        type: input.type,
        readAt: null,
        deletedAt: null
      };
      if (since) {
        where.createdAt = { [Op.gte]: since };
      }

      // For DMs also match legacy unread rows that never got a group_key.
      const existing = await Notification.findOne({
        where: isMessageGroup
          ? {
              userId: input.userId,
              type: input.type,
              readAt: null,
              deletedAt: null,
              [Op.or]: [
                { groupKey },
                {
                  groupKey: null,
                  actorUserId: input.actorUserId ?? null
                }
              ]
            }
          : where,
        order: [["updatedAt", "DESC"]],
        lock: Transaction.LOCK.UPDATE,
        transaction
      });

      if (existing) {
        const count = (existing.groupCount ?? 1) + 1;
        const name = actor.name ?? "Someone";
        const now = new Date();
        const meta = {
          ...(existing.metadata && typeof existing.metadata === "object"
            ? existing.metadata
            : {}),
          ...(input.metadata && typeof input.metadata === "object" ? input.metadata : {}),
          messageCount: count
        };
        await existing.update(
          {
            groupKey,
            groupCount: count,
            title: groupTitle(input.type, count, name),
            body: input.body ?? existing.body,
            actorUserId: input.actorUserId ?? existing.actorUserId,
            imageUrl: imageUrl ?? existing.imageUrl,
            actionType: input.actionType ?? existing.actionType,
            actionTargetId:
              input.actionTargetId != null
                ? String(input.actionTargetId)
                : existing.actionTargetId,
            metadata: meta,
            updatedAt: now,
            ...(isMessageGroup ? { createdAt: now } : {})
          } as any,
          { transaction }
        );
        row = existing;
        aggregated = true;
        return;
      }

      row = await Notification.create(
        {
          userId: input.userId,
          type: input.type,
          category,
          title: input.title,
          body: input.body?.trim() || null,
          imageUrl,
          actionType: input.actionType ?? NOTIFICATION_ACTIONS.NONE,
          actionTargetId:
            input.actionTargetId != null ? String(input.actionTargetId) : null,
          actorUserId: input.actorUserId ?? null,
          groupKey,
          groupCount: 1,
          priority,
          metadata: {
            ...(input.metadata ?? {}),
            ...(isMessageGroup ? { messageCount: 1 } : {})
          },
          readAt: null,
          deletedAt: null
        } as any,
        { transaction }
      );
    });
  }

  if (!row) {
    row = await Notification.create({
      userId: input.userId,
      type: input.type,
      category,
      title: input.title,
      body: input.body?.trim() || null,
      imageUrl,
      actionType: input.actionType ?? NOTIFICATION_ACTIONS.NONE,
      actionTargetId:
        input.actionTargetId != null ? String(input.actionTargetId) : null,
      actorUserId: input.actorUserId ?? null,
      groupKey: resolvedGroupKey,
      groupCount: 1,
      priority,
      metadata: input.metadata ?? null,
      readAt: null,
      deletedAt: null
    } as any);
  }

  // Self-heal races / legacy null group_key rows: one unread Activity card per peer.
  if (isMessageGroup && row && input.actorUserId != null && resolvedGroupKey) {
    row = await collapseUnreadMessageDuplicates(
      input.userId,
      input.actorUserId,
      input.type,
      row.id,
      resolvedGroupKey
    );
  }

  // Reload in case the transaction instance is stale
  if (row.id) {
    const fresh = await Notification.findByPk(row.id);
    if (fresh) row = fresh;
  }

  const dto = await toNotificationDto(row);
  const counts = await getUnreadCounts(input.userId);
  emitRealtime(input.userId, { notification: dto, counts });

  // First message in a group → push; later aggregates → realtime only (avoid push spam).
  if (!aggregated) {
    void queuePushNotification(input.userId, dto).catch((err) => {
      if (process.env.NODE_ENV === "development") {
        console.warn("[Push]", err);
      }
    });
  }

  return dto;
}

type PushPayloadInput = {
  title: string;
  body: string | null;
  category: NotificationCategory;
  priority: number;
  data: Record<string, string>;
};

async function deliverPushToTokenRows(
  userId: number,
  rows: PushDeviceToken[],
  payload: PushPayloadInput
): Promise<void> {
  if (!rows.length) {
    console.info(`[Push] userId=${userId} skip: no device tokens`);
    return;
  }

  const isHighPriority = payload.priority > 0 || payload.category === "MATRIMONY";
  const channelId = isHighPriority ? "matrimony" : "default";
  const bodyText = payload.body?.trim() || undefined;

  const expoRows = rows.filter((r) => isExpoPushToken(r.token));
  const fcmRows = rows.filter((r) => isFcmPushToken(r.token));

  console.info(
    `[Push] userId=${userId} type=${payload.data.type ?? "?"} expo=${expoRows.length} fcm=${fcmRows.length} channel=${channelId}`
  );

  const invalidTokens: string[] = [];
  let expoSent = 0;
  let fcmSent = 0;

  if (expoRows.length) {
    const { invalidTokens: bad, sent } = await sendExpoPush(
      expoRows.map((t) => ({
        to: t.token,
        title: payload.title,
        body: bodyText,
        sound: "default" as const,
        priority: (isHighPriority ? "high" : "default") as "high" | "default",
        channelId: t.platform === "android" ? channelId : undefined,
        data: payload.data
      }))
    );
    expoSent = sent;
    invalidTokens.push(...bad);
  }

  if (fcmRows.length) {
    if (!isFcmConfigured()) {
      console.warn(
        `[Push] userId=${userId} ${fcmRows.length} native token(s) ignored — FIREBASE_SERVICE_ACCOUNT_* not configured`
      );
    } else {
      const { invalidTokens: bad, sent } = await sendFcmPush(
        fcmRows.map((r) => r.token),
        {
          title: payload.title,
          body: bodyText,
          data: payload.data,
          priority: isHighPriority ? "high" : "normal"
        }
      );
      fcmSent = sent;
      invalidTokens.push(...bad);
    }
  }

  if (invalidTokens.length) {
    await PushDeviceToken.destroy({
      where: { userId, token: { [Op.in]: invalidTokens } }
    });
    console.info(`[Push] userId=${userId} removed ${invalidTokens.length} invalid token(s)`);
  }

  console.info(`[Push] userId=${userId} done expoSent=${expoSent} fcmSent=${fcmSent}`);
}

/** Expo + FCM push. Respects push + category preferences. */
async function queuePushNotification(userId: number, dto: NotificationDto): Promise<void> {
  const prefs = await ensurePreferences(userId);
  if (!prefs.pushEnabled) {
    console.info(`[Push] userId=${userId} skip: pushEnabled=false`);
    return;
  }
  if (!(await isCategoryEnabled(userId, dto.category))) {
    console.info(`[Push] userId=${userId} skip: category ${dto.category} disabled`);
    return;
  }

  const tokens = await PushDeviceToken.findAll({
    where: { userId },
    order: [["lastUsedAt", "DESC"]],
    limit: 50
  });

  await deliverPushToTokenRows(userId, tokens, {
    title: dto.title,
    body: dto.body,
    category: dto.category,
    priority: dto.priority,
    data: {
      notificationId: String(dto.id),
      type: dto.type,
      category: dto.category,
      actionType: dto.actionType ?? "",
      actionTargetId: dto.actionTargetId ?? "",
      actorUserId: dto.actorUserId != null ? String(dto.actorUserId) : "",
      actorName: dto.actorName ?? ""
    }
  });
}

/** Admin / direct push without in-app row */
async function pushToUsersDirect(
  userIds: number[],
  input: {
    title: string;
    body: string;
    category: NotificationCategory;
    actionType?: string;
    actionTargetId?: string | null;
  }
): Promise<{ pushTargets: number; pushSent: number }> {
  const uniqueIds = [...new Set(userIds.filter((id) => id > 0))];
  if (!uniqueIds.length) return { pushTargets: 0, pushSent: 0 };

  const isHighPriority = input.category === "MATRIMONY";
  const data = {
    notificationId: "0",
    type: NOTIFICATION_TYPES.ADMIN_BROADCAST,
    category: input.category,
    actionType: input.actionType ?? NOTIFICATION_ACTIONS.OPEN_NOTIFICATIONS,
    actionTargetId: input.actionTargetId ?? "",
    actorUserId: "",
    actorName: ""
  };

  let pushTargets = 0;
  let pushSent = 0;

  for (const userId of uniqueIds) {
    const prefs = await ensurePreferences(userId);
    if (!prefs.pushEnabled) continue;
    if (!(await isCategoryEnabled(userId, input.category))) continue;

    const tokens = await PushDeviceToken.findAll({
      where: { userId },
      order: [["lastUsedAt", "DESC"]],
      limit: 50
    });
    if (!tokens.length) continue;
    pushTargets += 1;

    const before = tokens.length;
    await deliverPushToTokenRows(userId, tokens, {
      title: input.title,
      body: input.body,
      category: input.category,
      priority: isHighPriority ? 1 : 0,
      data
    });
    pushSent += before;
  }

  return { pushTargets, pushSent };
}

export async function listNotifications(
  userId: number,
  opts: {
    page?: number;
    limit?: number;
    category?: NotificationCategory | "ALL";
  }
): Promise<{ items: NotificationDto[]; total: number; counts: UnreadCountsDto }> {
  const safeLimit = Math.min(50, Math.max(1, opts.limit ?? 25));
  const offset = (Math.max(1, opts.page ?? 1) - 1) * safeLimit;

  const where: Record<string, unknown> = {
    userId,
    deletedAt: null
  };
  if (opts.category && opts.category !== "ALL") {
    where.category = opts.category;
  }

  const { count, rows } = await Notification.findAndCountAll({
    where,
    order: [
      ["priority", "DESC"],
      ["updatedAt", "DESC"],
      ["createdAt", "DESC"]
    ],
    limit: safeLimit,
    offset
  });

  const items = await Promise.all(rows.map((r) => toNotificationDto(r)));
  const counts = await getUnreadCounts(userId);
  return { items, total: count, counts };
}

export async function markNotificationRead(userId: number, id: number): Promise<UnreadCountsDto> {
  const row = await Notification.findOne({ where: { id, userId, deletedAt: null } });
  if (row && !row.readAt) {
    await row.update({ readAt: new Date() } as any);
  }
  const counts = await getUnreadCounts(userId);
  getIo()?.to(`user:${userId}`).emit("notification:counts", counts);
  return counts;
}

export async function markAllNotificationsRead(
  userId: number,
  category?: NotificationCategory | "ALL"
): Promise<UnreadCountsDto> {
  const where: Record<string, unknown> = { userId, readAt: null, deletedAt: null };
  if (category && category !== "ALL") where.category = category;

  await Notification.update({ readAt: new Date() } as any, { where });
  const counts = await getUnreadCounts(userId);
  getIo()?.to(`user:${userId}`).emit("notification:counts", counts);
  return counts;
}

export async function deleteNotification(userId: number, id: number): Promise<UnreadCountsDto> {
  const row = await Notification.findOne({ where: { id, userId } });
  if (row) {
    await row.update({ deletedAt: new Date(), readAt: row.readAt ?? new Date() } as any);
  }
  const counts = await getUnreadCounts(userId);
  getIo()?.to(`user:${userId}`).emit("notification:counts", counts);
  return counts;
}

export async function deleteNotificationsBulk(
  userId: number,
  ids: number[]
): Promise<UnreadCountsDto> {
  if (!ids.length) return getUnreadCounts(userId);
  await Notification.update(
    { deletedAt: new Date() } as any,
    { where: { userId, id: { [Op.in]: ids } } }
  );
  const counts = await getUnreadCounts(userId);
  getIo()?.to(`user:${userId}`).emit("notification:counts", counts);
  return counts;
}

export async function deleteAllNotifications(
  userId: number,
  category?: NotificationCategory | "ALL"
): Promise<UnreadCountsDto> {
  const where: Record<string, unknown> = { userId, deletedAt: null };
  if (category && category !== "ALL") where.category = category;
  const now = new Date();
  await Notification.update({ deletedAt: now, readAt: now } as any, { where });
  const counts = await getUnreadCounts(userId);
  getIo()?.to(`user:${userId}`).emit("notification:counts", counts);
  return counts;
}

export async function getPreferences(userId: number) {
  const row = await ensurePreferences(userId);
  return {
    socialEnabled: row.socialEnabled,
    matrimonyEnabled: row.matrimonyEnabled,
    messagesEnabled: row.messagesEnabled,
    communityEnabled: row.communityEnabled,
    systemEnabled: row.systemEnabled,
    pushEnabled: row.pushEnabled
  };
}

export async function updatePreferences(
  userId: number,
  patch: Partial<{
    socialEnabled: boolean;
    matrimonyEnabled: boolean;
    messagesEnabled: boolean;
    communityEnabled: boolean;
    systemEnabled: boolean;
    pushEnabled: boolean;
  }>
) {
  const row = await ensurePreferences(userId);
  await row.update(patch as any);
  return getPreferences(userId);
}

export async function registerPushToken(
  userId: number,
  input: {
    token: string;
    platform: "ios" | "android" | "web";
    deviceId?: string | null;
    appVersion?: string | null;
  }
) {
  const token = input.token.trim();
  if (!token) throw Object.assign(new Error("Token required"), { status: 400 });

  // Only accept Expo push tokens. Native FCM/APNs tokens require a separate FCM path
  // and were previously registered by addPushTokenListener by mistake.
  if (!isExpoPushToken(token)) {
    throw Object.assign(
      new Error("Only Expo push tokens (ExponentPushToken[…] / ExpoPushToken[…]) are accepted"),
      { status: 400 }
    );
  }

  // Hard gate: mobile token-listener storms can hit 10+/sec. Drop before any DB work.
  const minIntervalMs = Math.max(
    15_000,
    Number(process.env.PUSH_TOKEN_REGISTER_MIN_INTERVAL_MS || 60_000)
  );
  const prevHit = pushRegisterHits.get(userId) ?? 0;
  const now = Date.now();
  if (now - prevHit < minIntervalMs) {
    return { ok: true, skipped: true as const };
  }
  pushRegisterHits.set(userId, now);
  if (pushRegisterHits.size > 20_000) {
    // Bound memory on long-lived API process
    const cutoff = now - minIntervalMs * 2;
    for (const [uid, ts] of pushRegisterHits) {
      if (ts < cutoff) pushRegisterHits.delete(uid);
    }
  }

  // Prefer find → create to avoid stampede duplicates when table has no unique index.
  let row = await PushDeviceToken.findOne({ where: { userId, token } });
  let created = false;
  if (!row) {
    try {
      row = await PushDeviceToken.create({
        userId,
        token,
        platform: input.platform,
        deviceId: input.deviceId ?? null,
        appVersion: input.appVersion ?? null,
        lastUsedAt: new Date()
      } as any);
      created = true;
    } catch {
      row = await PushDeviceToken.findOne({ where: { userId, token } });
      if (!row) throw Object.assign(new Error("Could not save push token"), { status: 500 });
    }
  }

  const lastUsedMs = row.lastUsedAt ? new Date(row.lastUsedAt).getTime() : 0;
  const staleMs = Math.max(60_000, Number(process.env.PUSH_TOKEN_TOUCH_INTERVAL_MS || 900_000));
  // Ignore volatile session deviceIds — they flip every cold start and force needless writes.
  const stableDeviceId =
    input.deviceId && !String(input.deviceId).startsWith("ExponentPushToken")
      ? input.deviceId
      : null;
  const needsTouch =
    created ||
    row.platform !== input.platform ||
    (stableDeviceId != null && row.deviceId !== stableDeviceId) ||
    (input.appVersion != null && row.appVersion !== input.appVersion) ||
    now - lastUsedMs >= staleMs;

  if (needsTouch && !created) {
    await row.update({
      platform: input.platform,
      deviceId: stableDeviceId ?? row.deviceId,
      appVersion: input.appVersion ?? row.appVersion,
      lastUsedAt: new Date()
    } as any);
  }

  if (created) {
    console.info(
      `[Push] registered Expo token userId=${userId} platform=${input.platform} device=${stableDeviceId ? "yes" : "no"}`
    );
  }
  return { ok: true };
}

/** Per-user last successful register attempt (in-process). */
const pushRegisterHits = new Map<number, number>();

export async function getNotificationAudienceStats(): Promise<{
  approvedUsers: number;
  usersWithPushTokens: number;
  totalPushTokens: number;
  fcmConfigured: boolean;
}> {
  const approvedUsers = await User.count({ where: { status: "APPROVED" } });
  const usersWithPushTokens = await PushDeviceToken.count({
    distinct: true,
    col: "user_id"
  });
  const totalPushTokens = await PushDeviceToken.count();
  return {
    approvedUsers,
    usersWithPushTokens,
    totalPushTokens,
    fcmConfigured: isFcmConfigured()
  };
}

export async function adminBroadcast(input: {
  title: string;
  body: string;
  category?: NotificationCategory;
  userIds?: number[];
  actionType?: NotificationActionType;
  actionTargetId?: string | null;
  /** When false, only device push (no notification center row) */
  persistInApp?: boolean;
}) {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) {
    throw Object.assign(new Error("Title and body required"), { status: 400 });
  }

  let userIds = input.userIds?.filter((id) => id > 0) ?? [];
  if (!userIds.length) {
    const users = await User.findAll({
      where: { status: "APPROVED" },
      attributes: ["id"]
    });
    userIds = users.map((u) => u.id);
  }

  if (!userIds.length) {
    throw Object.assign(new Error("No approved users to notify. Approve users first."), {
      status: 400
    });
  }

  const category = input.category ?? "COMMUNITY";
  const persistInApp = input.persistInApp !== false;

  if (!persistInApp) {
    const push = await pushToUsersDirect(userIds, {
      title,
      body,
      category,
      actionType: input.actionType ?? NOTIFICATION_ACTIONS.OPEN_NOTIFICATIONS,
      actionTargetId: input.actionTargetId ?? null
    });
    return {
      sent: 0,
      total: userIds.length,
      persistInApp: false,
      inAppSent: 0,
      pushTargets: push.pushTargets,
      pushSent: push.pushSent
    };
  }

  const batchSize = 50;
  let sent = 0;
  const failures: string[] = [];

  for (let i = 0; i < userIds.length; i += batchSize) {
    const chunk = userIds.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      chunk.map((userId) =>
        dispatchNotification({
          userId,
          type: NOTIFICATION_TYPES.ADMIN_BROADCAST,
          category,
          title,
          body,
          actionType: input.actionType ?? NOTIFICATION_ACTIONS.OPEN_NOTIFICATIONS,
          actionTargetId: input.actionTargetId ?? null,
          force: true,
          metadata: { broadcast: true, category }
        })
      )
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        sent += 1;
      } else if (r.status === "rejected") {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        if (failures.length < 3) failures.push(msg);
      }
    }
  }

  let pushTargets = 0;
  try {
    pushTargets = await PushDeviceToken.count({
      where: { userId: { [Op.in]: userIds } },
      distinct: true,
      col: "user_id"
    });
  } catch {
    pushTargets = 0;
  }

  if (sent === 0 && failures.length > 0) {
    const hint = failures[0].includes("Unknown column")
      ? " Run backend/migrations/notifications-platform.sql on your database."
      : "";
    throw Object.assign(new Error(`${failures[0]}${hint}`), { status: 500 });
  }

  return {
    sent,
    total: userIds.length,
    persistInApp: true,
    inAppSent: sent,
    pushTargets,
    pushSent: null as number | null,
    failed: failures.length
  };
}
