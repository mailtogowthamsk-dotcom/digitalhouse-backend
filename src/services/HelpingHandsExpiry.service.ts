/**
 * Helping Hands lifecycle — expire due requests + pre-expiry reminders.
 * Pattern mirrors MarketplaceExpiry.service (setInterval, env toggles).
 */
import { Op } from "sequelize";
import { Post } from "../models";
import {
  HELP_ACTIVE_STATUSES,
  HELP_EXPIRY_REMINDER_HOURS
} from "../constants/helpingHands.constants";
import type { HelpStatus } from "../constants/helpingHands.constants";
import * as Notifications from "./Notification.service";

const JOB_INTERVAL_MS = Number(
  process.env.HELPING_HANDS_EXPIRY_JOB_INTERVAL_MS || 15 * 60 * 1000
);
const JOB_ENABLED = process.env.HELPING_HANDS_EXPIRY_JOB_ENABLED !== "false";

let jobTimer: ReturnType<typeof setInterval> | null = null;
let jobRunning = false;

/** OPEN/IN_PROGRESS past helpExpiresAt → EXPIRED + drop urgent flag. */
export async function expireDueHelpRequests(): Promise<number> {
  const now = new Date();
  const due = await Post.findAll({
    where: {
      postType: "HELP_REQUEST",
      helpStatus: { [Op.in]: HELP_ACTIVE_STATUSES },
      helpExpiresAt: { [Op.lte]: now }
    },
    limit: 200
  });

  let count = 0;
  for (const post of due) {
    const already = post.helpExpiryReminder === "EXPIRED";
    await post.update({
      helpStatus: "EXPIRED" as HelpStatus,
      urgent: false,
      helpExpiryReminder: "EXPIRED"
    });
    if (!already) {
      void Notifications.notifyHelpRequestExpired(post.userId, post.id, post.title).catch(
        () => {}
      );
    }
    count += 1;
  }
  return count;
}

/** Notify authors ~1 hour before expiry (configurable). */
export async function sendHelpExpiryReminders(): Promise<number> {
  const now = new Date();
  const windowMs = Math.max(HELP_EXPIRY_REMINDER_HOURS, 0.25) * 60 * 60 * 1000;
  const soon = new Date(now.getTime() + windowMs);

  const rows = await Post.findAll({
    where: {
      postType: "HELP_REQUEST",
      helpStatus: { [Op.in]: HELP_ACTIVE_STATUSES },
      helpExpiresAt: { [Op.gt]: now, [Op.lte]: soon },
      [Op.or]: [
        { helpExpiryReminder: null },
        { helpExpiryReminder: { [Op.notIn]: ["H1", "EXPIRED"] } }
      ]
    },
    limit: 200
  });

  let count = 0;
  for (const post of rows) {
    await post.update({ helpExpiryReminder: "H1" });
    void Notifications.notifyHelpRequestExpiring(
      post.userId,
      post.id,
      post.title,
      HELP_EXPIRY_REMINDER_HOURS
    ).catch(() => {});
    count += 1;
  }
  return count;
}

export async function runHelpingHandsExpiryJobs(): Promise<void> {
  if (jobRunning) return;
  jobRunning = true;
  try {
    const expired = await expireDueHelpRequests();
    const reminders = await sendHelpExpiryReminders();
    if (expired > 0 || reminders > 0) {
      console.log("[helping-hands-expiry-job]", { expired, reminders });
    }
  } catch (e) {
    console.error("[helping-hands-expiry-job] failed", e);
  } finally {
    jobRunning = false;
  }
}

export function startHelpingHandsExpiryJobs(): void {
  if (!JOB_ENABLED) {
    console.log("[helping-hands-expiry-job] disabled");
    return;
  }
  if (jobTimer) return;
  void runHelpingHandsExpiryJobs();
  jobTimer = setInterval(() => void runHelpingHandsExpiryJobs(), JOB_INTERVAL_MS);
  console.log(
    `[helping-hands-expiry-job] scheduled every ${Math.round(JOB_INTERVAL_MS / 60000)} min`
  );
}
