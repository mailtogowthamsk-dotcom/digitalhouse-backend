import { Op, UniqueConstraintError } from "sequelize";
import { sequelize } from "../../config/db";
import {
  ANALYTICS_DEDUP_WINDOW_MS,
  dailyStatsSqlColumn,
  IMPRESSION_GRACE_MS,
  remainingDays,
  roundCtrPercent,
  type AdvertisementEventType
} from "../../constants/advertisement.constants";
import {
  Advertisement,
  AdvertisementDailyStat,
  AdvertisementEvent,
  AdvertisementUniqueReach
} from "../../models/Advertisement.models";
import { isCurrentlyDeliverable } from "./AdvertisementState.service";
import { getOwned } from "./Advertisement.service";
import { assertSafeHttpUrl } from "../../utils/safeUrl";

function httpError(message: string, status: number, code?: string) {
  return Object.assign(new Error(message), { status, code });
}

function utcDateKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

async function recentlyCounted(
  advertisementId: number,
  userId: number,
  eventType: AdvertisementEventType,
  placement: string,
  action?: string | null
): Promise<boolean> {
  const since = new Date(Date.now() - ANALYTICS_DEDUP_WINDOW_MS);
  const row = await AdvertisementEvent.findOne({
    where: {
      advertisementId,
      userId,
      eventType,
      placement,
      createdAt: { [Op.gte]: since },
      ...(eventType === "click" && action ? { action } : {})
    },
    attributes: ["id"]
  });
  return !!row;
}

async function upsertUserExposure(
  userId: number,
  advertisementId: number,
  kind: "impression" | "click"
): Promise<void> {
  const now = new Date();
  if (kind === "impression") {
    await sequelize.query(
      `INSERT INTO advertisement_user_exposures
        (user_id, advertisement_id, last_impression_at, impression_count, last_click_at, click_count, created_at, updated_at)
       VALUES (?, ?, ?, 1, NULL, 0, ?, ?)
       ON DUPLICATE KEY UPDATE
         last_impression_at = VALUES(last_impression_at),
         impression_count = impression_count + 1,
         updated_at = VALUES(updated_at)`,
      { replacements: [userId, advertisementId, now, now, now] }
    );
    return;
  }
  await sequelize.query(
    `INSERT INTO advertisement_user_exposures
      (user_id, advertisement_id, last_impression_at, impression_count, last_click_at, click_count, created_at, updated_at)
     VALUES (?, ?, NULL, 0, ?, 1, ?, ?)
     ON DUPLICATE KEY UPDATE
       last_click_at = VALUES(last_click_at),
       click_count = click_count + 1,
       updated_at = VALUES(updated_at)`,
    { replacements: [userId, advertisementId, now, now, now] }
  );
}

async function bumpDaily(
  advertisementId: number,
  field: "impressions" | "clicks" | "uniqueViewers"
): Promise<void> {
  const statDate = utcDateKey();
  const now = new Date();
  const column = dailyStatsSqlColumn(field);
  await sequelize.query(
    `INSERT INTO advertisement_daily_stats
      (advertisement_id, stat_date, impressions, unique_viewers, clicks, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       ${column} = ${column} + 1,
       updated_at = VALUES(updated_at)`,
    {
      replacements: [
        advertisementId,
        statDate,
        field === "impressions" ? 1 : 0,
        field === "uniqueViewers" ? 1 : 0,
        field === "clicks" ? 1 : 0,
        now,
        now
      ]
    }
  );
}

export async function recordImpression(params: {
  advertisementId: number;
  userId: number;
  placement: string;
  platform?: string;
  eventId?: string;
}): Promise<{ counted: boolean; duplicate: boolean }> {
  const ad = await Advertisement.findByPk(params.advertisementId);
  if (!ad) throw httpError("Advertisement not found", 404, "NOT_FOUND");

  const now = new Date();
  const deliverable = isCurrentlyDeliverable(ad, now);
  const recentlyDelivered =
    ad.lastDeliveredAt != null && now.getTime() - ad.lastDeliveredAt.getTime() <= IMPRESSION_GRACE_MS;
  if (!deliverable && !recentlyDelivered) {
    return { counted: false, duplicate: false };
  }

  if (params.eventId) {
    try {
      await AdvertisementEvent.create({
        eventId: params.eventId.slice(0, 64),
        advertisementId: ad.id,
        userId: params.userId,
        eventType: "impression",
        action: null,
        placement: params.placement.slice(0, 32),
        platform: params.platform?.slice(0, 16) ?? null,
        createdAt: now
      });
    } catch (err) {
      if (err instanceof UniqueConstraintError) return { counted: false, duplicate: true };
      throw err;
    }
  } else {
    if (await recentlyCounted(ad.id, params.userId, "impression", params.placement)) {
      return { counted: false, duplicate: true };
    }
    await AdvertisementEvent.create({
      eventId: null,
      advertisementId: ad.id,
      userId: params.userId,
      eventType: "impression",
      action: null,
      placement: params.placement.slice(0, 32),
      platform: params.platform?.slice(0, 16) ?? null,
      createdAt: now
    });
  }

  await ad.increment("impressionsCount");
  await bumpDaily(ad.id, "impressions");
  await upsertUserExposure(params.userId, ad.id, "impression");

  try {
    await AdvertisementUniqueReach.create({
      advertisementId: ad.id,
      userId: params.userId,
      firstSeenAt: now
    });
    await ad.increment("uniqueReachCount");
    await bumpDaily(ad.id, "uniqueViewers");
  } catch (err) {
    if (!(err instanceof UniqueConstraintError)) throw err;
  }

  return { counted: true, duplicate: false };
}

export async function recordClick(params: {
  advertisementId: number;
  userId: number;
  placement: string;
  platform?: string;
  eventId?: string;
  action?: string;
}): Promise<{ counted: boolean; duplicate: boolean; destinationUrl: string | null }> {
  const ad = await Advertisement.findByPk(params.advertisementId);
  if (!ad) throw httpError("Advertisement not found", 404, "NOT_FOUND");

  const now = new Date();
  const deliverable = isCurrentlyDeliverable(ad, now);
  const recentlyDelivered =
    ad.lastDeliveredAt != null && now.getTime() - ad.lastDeliveredAt.getTime() <= IMPRESSION_GRACE_MS;
  if (!deliverable && !recentlyDelivered) {
    return { counted: false, duplicate: false, destinationUrl: ad.websiteUrl || ad.destinationUrl };
  }

  const action = params.action?.slice(0, 32) ?? "cta";

  if (params.eventId) {
    try {
      await AdvertisementEvent.create({
        eventId: params.eventId.slice(0, 64),
        advertisementId: ad.id,
        userId: params.userId,
        eventType: "click",
        action,
        placement: params.placement.slice(0, 32),
        platform: params.platform?.slice(0, 16) ?? null,
        createdAt: now
      });
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        return { counted: false, duplicate: true, destinationUrl: ad.websiteUrl || ad.destinationUrl };
      }
      throw err;
    }
  } else {
    if (await recentlyCounted(ad.id, params.userId, "click", params.placement, action)) {
      return { counted: false, duplicate: true, destinationUrl: ad.websiteUrl || ad.destinationUrl };
    }
    await AdvertisementEvent.create({
      eventId: null,
      advertisementId: ad.id,
      userId: params.userId,
      eventType: "click",
      action,
      placement: params.placement.slice(0, 32),
      platform: params.platform?.slice(0, 16) ?? null,
      createdAt: now
    });
  }

  await ad.increment("clicksCount");
  await bumpDaily(ad.id, "clicks");
  await upsertUserExposure(params.userId, ad.id, "click");
  return { counted: true, duplicate: false, destinationUrl: ad.websiteUrl || ad.destinationUrl };
}

export async function resolveClickRedirect(
  advertisementId: number,
  userId: number,
  placement: string,
  platform?: string
): Promise<string> {
  const result = await recordClick({ advertisementId, userId, placement, platform });
  if (!result.destinationUrl) {
    throw httpError("This advertisement has no destination", 400, "NO_DESTINATION");
  }
  return assertSafeHttpUrl(result.destinationUrl);
}

export async function getAdvertiserAnalytics(userId: number, advertisementId: number) {
  const ad = await getOwned(userId, advertisementId);
  const daily = await AdvertisementDailyStat.findAll({
    where: { advertisementId: ad.id },
    order: [["statDate", "ASC"]],
    limit: 90
  });
  return {
    advertisementId: ad.id,
    status: ad.status,
    remainingDays: remainingDays(ad.scheduledEndAt),
    totals: {
      impressions: ad.impressionsCount,
      uniqueReach: ad.uniqueReachCount,
      clicks: ad.clicksCount,
      ctr: roundCtrPercent(ad.clicksCount, ad.impressionsCount)
    },
    daily: daily.map((d) => ({
      date: d.statDate,
      impressions: d.impressions,
      uniqueViewers: d.uniqueViewers,
      clicks: d.clicks,
      ctr: roundCtrPercent(d.clicks, d.impressions)
    })),
    actions: await getClickActionCounts(ad.id)
  };
}

export async function getClickActionCounts(advertisementId: number): Promise<Record<string, number>> {
  const [rows] = (await sequelize.query(
    `SELECT COALESCE(action, 'cta') AS action, COUNT(*) AS cnt
     FROM advertisement_events
     WHERE advertisement_id = ? AND event_type = 'click'
     GROUP BY COALESCE(action, 'cta')`,
    { replacements: [advertisementId] }
  )) as [Array<{ action: string; cnt: number }>, unknown];
  const counts: Record<string, number> = {
    open: 0,
    call: 0,
    whatsapp: 0,
    website: 0,
    email: 0,
    directions: 0,
    cta: 0
  };
  for (const row of rows) {
    counts[row.action] = Number(row.cnt);
  }
  return counts;
}

export async function getAdminAnalytics(from?: Date, to?: Date) {
  const start = from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = to ?? new Date();

  const [statusRows] = (await sequelize.query(
    `SELECT status, COUNT(*) AS cnt FROM advertisements GROUP BY status`
  )) as [Array<{ status: string; cnt: number }>, unknown];

  const statusCounts = Object.fromEntries(statusRows.map((r) => [r.status, Number(r.cnt)]));

  const [perf] = (await sequelize.query(
    `SELECT
        COALESCE(SUM(impressions_count),0) AS impressions,
        COALESCE(SUM(unique_reach_count),0) AS uniqueReach,
        COALESCE(SUM(clicks_count),0) AS clicks
     FROM advertisements`
  )) as [Array<{ impressions: number; uniqueReach: number; clicks: number }>, unknown];

  const impressions = Number(perf[0]?.impressions ?? 0);
  const uniqueReach = Number(perf[0]?.uniqueReach ?? 0);
  const clicks = Number(perf[0]?.clicks ?? 0);

  const [revenueRow] = (await sequelize.query(
    `SELECT COALESCE(SUM(amount_paise),0) AS revenuePaise
     FROM payment_orders
     WHERE module = 'advertisement' AND status = 'PAID'
       AND created_at >= ? AND created_at <= ?`,
    { replacements: [start, end] }
  )) as [Array<{ revenuePaise: number }>, unknown];

  const [refundRow] = (await sequelize.query(
    `SELECT COALESCE(SUM(amount_paise),0) AS refundPaise
     FROM payment_refunds
     WHERE status = 'PROCESSED' AND created_at >= ? AND created_at <= ?
       AND payment_order_id IN (
         SELECT id FROM payment_orders WHERE module = 'advertisement'
       )`,
    { replacements: [start, end] }
  )) as [Array<{ refundPaise: number }>, unknown];

  const revenuePaise = Number(revenueRow[0]?.revenuePaise ?? 0);
  const refundPaise = Number(refundRow[0]?.refundPaise ?? 0);

  const [byDate] = (await sequelize.query(
    `SELECT DATE(created_at) AS d, COALESCE(SUM(amount_paise),0) AS revenuePaise
     FROM payment_orders
     WHERE module = 'advertisement' AND status = 'PAID'
       AND created_at >= ? AND created_at <= ?
     GROUP BY DATE(created_at)
     ORDER BY d ASC`,
    { replacements: [start, end] }
  )) as [Array<{ d: string; revenuePaise: number }>, unknown];

  const [byType] = (await sequelize.query(
    `SELECT a.type_code AS typeCode, COALESCE(SUM(p.amount_paise),0) AS revenuePaise
     FROM payment_orders p
     JOIN advertisements a ON a.id = p.reference_id
     WHERE p.module = 'advertisement' AND p.status = 'PAID'
       AND p.created_at >= ? AND p.created_at <= ?
     GROUP BY a.type_code`,
    { replacements: [start, end] }
  )) as [Array<{ typeCode: string; revenuePaise: number }>, unknown];

  const [byDuration] = (await sequelize.query(
    `SELECT a.duration_days AS durationDays, COALESCE(SUM(p.amount_paise),0) AS revenuePaise
     FROM payment_orders p
     JOIN advertisements a ON a.id = p.reference_id
     WHERE p.module = 'advertisement' AND p.status = 'PAID'
       AND p.created_at >= ? AND p.created_at <= ?
     GROUP BY a.duration_days`,
    { replacements: [start, end] }
  )) as [Array<{ durationDays: number; revenuePaise: number }>, unknown];

  const top = await Advertisement.findAll({
    where: { impressionsCount: { [Op.gt]: 0 } },
    order: [["clicksCount", "DESC"]],
    limit: 10,
    attributes: ["id", "title", "typeCode", "status", "impressionsCount", "uniqueReachCount", "clicksCount"]
  });

  return {
    from: start,
    to: end,
    campaigns: {
      active: Number(statusCounts.ACTIVE ?? 0),
      pendingReview: Number(statusCounts.PENDING_REVIEW ?? 0),
      scheduled: Number(statusCounts.SCHEDULED ?? 0),
      paused: Number(statusCounts.PAUSED ?? 0),
      expired: Number(statusCounts.EXPIRED ?? 0),
      rejected: Number(statusCounts.REJECTED ?? 0),
      cancelled: Number(statusCounts.CANCELLED ?? 0)
    },
    performance: {
      impressions,
      uniqueReach,
      clicks,
      averageCtr: roundCtrPercent(clicks, impressions)
    },
    revenue: {
      source: "payment_orders",
      grossPaise: revenuePaise,
      refundedPaise: refundPaise,
      netPaise: revenuePaise - refundPaise
    },
    revenueByDate: byDate.map((r) => ({ date: r.d, revenuePaise: Number(r.revenuePaise) })),
    revenueByType: byType.map((r) => ({ typeCode: r.typeCode, revenuePaise: Number(r.revenuePaise) })),
    revenueByDuration: byDuration.map((r) => ({
      durationDays: Number(r.durationDays),
      revenuePaise: Number(r.revenuePaise)
    })),
    top: top.map((a) => ({
      id: a.id,
      title: a.title,
      typeCode: a.typeCode,
      status: a.status,
      impressions: a.impressionsCount,
      uniqueReach: a.uniqueReachCount,
      clicks: a.clicksCount,
      ctr: roundCtrPercent(a.clicksCount, a.impressionsCount)
    }))
  };
}
