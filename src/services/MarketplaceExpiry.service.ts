/**
 * Marketplace Phase 3 — expiry reminders, expire live listings, archive old sold.
 */
import { Op } from "sequelize";
import { Post } from "../models";
import {
  MARKETPLACE_SOLD_RETENTION_DAYS
} from "../constants/marketplace.constants";
import type { MarketplaceStatus } from "../constants/marketplace.constants";
import * as Notifications from "./Notification.service";

const JOB_INTERVAL_MS = Number(
  process.env.MARKETPLACE_EXPIRY_JOB_INTERVAL_MS || 60 * 60 * 1000
);
const JOB_ENABLED = process.env.MARKETPLACE_EXPIRY_JOB_ENABLED !== "false";

let jobTimer: ReturnType<typeof setInterval> | null = null;
let jobRunning = false;

function daysUntil(date: Date, now: Date): number {
  const ms = date.getTime() - now.getTime();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/** LIVE past expiresAt → EXPIRED + notify once. */
export async function expireDueMarketplaceListings(): Promise<number> {
  const now = new Date();
  const due = await Post.findAll({
    where: {
      postType: "MARKETPLACE",
      marketplaceStatus: "LIVE",
      marketplaceExpiresAt: { [Op.lte]: now }
    },
    limit: 200
  });

  let count = 0;
  for (const post of due) {
    const already = post.marketplaceExpiryReminder === "EXPIRED";
    await post.update({
      marketplaceStatus: "EXPIRED" as MarketplaceStatus,
      marketplaceExpiryReminder: "EXPIRED",
      marketplaceFeatured: false,
      marketplaceFeaturedAt: null
    });
    if (!already) {
      void Notifications.notifyMarketplaceListingExpired(
        post.userId,
        post.id,
        post.title
      ).catch(() => {});
    }
    count += 1;
  }
  return count;
}

/** Remind LIVE listings 3 days and 1 day before expiry. */
export async function sendMarketplaceExpiryReminders(): Promise<{ d3: number; d1: number }> {
  const now = new Date();
  const live = await Post.findAll({
    where: {
      postType: "MARKETPLACE",
      marketplaceStatus: "LIVE",
      marketplaceExpiresAt: { [Op.ne]: null }
    },
    limit: 500
  });

  let d3 = 0;
  let d1 = 0;
  for (const post of live) {
    if (!post.marketplaceExpiresAt) continue;
    const days = daysUntil(post.marketplaceExpiresAt, now);
    const stage = post.marketplaceExpiryReminder;

    if (days <= 1 && days > 0 && stage !== "D1" && stage !== "EXPIRED") {
      await post.update({ marketplaceExpiryReminder: "D1" });
      void Notifications.notifyMarketplaceListingExpiring(
        post.userId,
        post.id,
        post.title,
        1
      ).catch(() => {});
      d1 += 1;
    } else if (days <= 3 && days > 1 && !stage) {
      await post.update({ marketplaceExpiryReminder: "D3" });
      void Notifications.notifyMarketplaceListingExpiring(
        post.userId,
        post.id,
        post.title,
        3
      ).catch(() => {});
      d3 += 1;
    }
  }
  return { d3, d1 };
}

/** Auto-archive SOLD listings older than retention window. */
export async function archiveOldSoldMarketplaceListings(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MARKETPLACE_SOLD_RETENTION_DAYS);
  const rows = await Post.findAll({
    where: {
      postType: "MARKETPLACE",
      marketplaceStatus: "SOLD",
      updatedAt: { [Op.lte]: cutoff }
    },
    limit: 200
  });
  for (const post of rows) {
    await post.update({
      marketplaceStatus: "ARCHIVED" as MarketplaceStatus,
      marketplaceFeatured: false,
      marketplaceFeaturedAt: null
    });
  }
  return rows.length;
}

export async function runMarketplaceExpiryJobs(): Promise<void> {
  if (jobRunning) return;
  jobRunning = true;
  try {
    const expired = await expireDueMarketplaceListings();
    const reminders = await sendMarketplaceExpiryReminders();
    const archived = await archiveOldSoldMarketplaceListings();
    if (expired > 0 || reminders.d3 > 0 || reminders.d1 > 0 || archived > 0) {
      console.log("[marketplace-expiry-job]", { expired, reminders, archived });
    }
  } catch (e) {
    console.error("[marketplace-expiry-job] failed", e);
  } finally {
    jobRunning = false;
  }
}

export function startMarketplaceExpiryJobs(): void {
  if (!JOB_ENABLED) {
    console.log("[marketplace-expiry-job] disabled");
    return;
  }
  if (jobTimer) return;
  void runMarketplaceExpiryJobs();
  jobTimer = setInterval(() => void runMarketplaceExpiryJobs(), JOB_INTERVAL_MS);
  console.log(
    `[marketplace-expiry-job] scheduled every ${Math.round(JOB_INTERVAL_MS / 60000)} min`
  );
}
