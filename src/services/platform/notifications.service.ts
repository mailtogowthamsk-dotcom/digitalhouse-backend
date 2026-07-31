import { Op } from "sequelize";
import {
  PlatformNotification,
  User,
  MatrimonySubscription
} from "../../models";
import { type PlatformAudience, type PlatformNotifKind } from "../../constants/platform.constants";
import { adminBroadcast } from "../Notification.service";
import * as SchedulerTracking from "../SystemSchedulerTracking.service";
import { audit, now } from "./shared";

export async function listPlatformNotifications(kind?: string) {
  const where: any = {};
  if (kind) where.kind = kind;
  const rows = await PlatformNotification.findAll({ where, order: [["createdAt", "DESC"]], limit: 100 });
  return rows.map((n) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    imageUrl: n.imageUrl,
    deepLink: n.deepLink,
    audience: n.audience,
    status: n.status,
    scheduledAt: n.scheduledAt?.toISOString() ?? null,
    sentAt: n.sentAt?.toISOString() ?? null,
    createdBy: n.createdBy,
    createdAt: n.createdAt.toISOString()
  }));
}

async function resolveAudienceUserIds(audience: PlatformAudience): Promise<number[] | undefined> {
  if (audience === "ALL") return undefined;
  if (audience === "ANDROID" || audience === "IOS") {
    // Platform targeting is stored for future push-token filtering; broadcast to all for now
    return undefined;
  }
  if (audience === "PREMIUM") {
    const subs = await MatrimonySubscription.findAll({
      where: { status: "ACTIVE" },
      attributes: ["userId"]
    });
    return [...new Set(subs.map((s) => s.userId))];
  }
  if (audience === "FREE") {
    const premium = await MatrimonySubscription.findAll({
      where: { status: "ACTIVE" },
      attributes: ["userId"]
    });
    const premiumIds = new Set(premium.map((s) => s.userId));
    const users = await User.findAll({
      where: { status: "APPROVED" },
      attributes: ["id"]
    });
    return users.map((u) => u.id).filter((id) => !premiumIds.has(id));
  }
  return undefined;
}

export async function createPlatformNotification(
  adminEmail: string | null,
  input: {
    kind: PlatformNotifKind;
    title: string;
    body: string;
    imageUrl?: string | null;
    deepLink?: string | null;
    audience?: PlatformAudience;
    scheduledAt?: string | null;
    sendNow?: boolean;
  }
) {
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  const sendNow = Boolean(input.sendNow) || input.kind === "EMERGENCY";
  // Any provided schedule is SCHEDULED (worker sends when due, including overdue).
  const status = sendNow ? "SENT" : scheduledAt ? "SCHEDULED" : "DRAFT";

  const row = await PlatformNotification.create({
    kind: input.kind,
    title: input.title.trim(),
    body: input.body.trim(),
    imageUrl: input.imageUrl ?? null,
    deepLink: input.deepLink ?? null,
    audience: input.audience ?? "ALL",
    status,
    scheduledAt,
    sentAt: sendNow ? now() : null,
    createdBy: adminEmail,
    createdAt: now(),
    updatedAt: now()
  } as any);

  let broadcastResult: unknown = null;
  if (sendNow) {
    const userIds = await resolveAudienceUserIds((input.audience ?? "ALL") as PlatformAudience);
    broadcastResult = await adminBroadcast({
      title: input.title.trim(),
      body: input.body.trim(),
      category: input.kind === "EMERGENCY" ? "SYSTEM" : "COMMUNITY",
      userIds,
      actionType: input.deepLink ? "NONE" : undefined,
      persistInApp: true
    });
  } else if (scheduledAt && scheduledAt <= now()) {
    // Overdue schedule — send on the next worker tick (or immediately via process)
    // Kick an async pass so admins don't wait a full interval for past-due schedules.
    void processScheduledPlatformNotifications().catch((e) =>
      console.error("[platform-notif-job] immediate overdue pass failed", e)
    );
  }

  await audit(adminEmail, sendNow ? `${input.kind}_SENT` : `${input.kind}_CREATED`, "notifications", {
    id: row.id,
    audience: input.audience
  });

  return { notification: row, broadcastResult };
}

export async function sendPlatformNotification(adminEmail: string | null, id: number) {
  const row = await PlatformNotification.findByPk(id);
  if (!row) throw Object.assign(new Error("Notification not found"), { status: 404 });
  if (row.status === "SENT") throw Object.assign(new Error("Already sent"), { status: 400 });

  const userIds = await resolveAudienceUserIds(row.audience as PlatformAudience);
  const broadcastResult = await adminBroadcast({
    title: row.title,
    body: row.body,
    category: row.kind === "EMERGENCY" ? "SYSTEM" : "COMMUNITY",
    userIds,
    persistInApp: true
  });
  await row.update({ status: "SENT", sentAt: now(), updatedAt: now() } as any);
  await audit(adminEmail, `${row.kind}_SENT`, "notifications", { id });
  return { notification: row, broadcastResult };
}

let platformNotifJobRunning = false;
let platformNotifTimer: ReturnType<typeof setInterval> | null = null;
const PLATFORM_NOTIF_SCHEDULER_KEY = "platform_scheduled_notifications" as const;

export function getPlatformNotificationJobRuntimeStatus() {
  const intervalMs = Math.max(
    15_000,
    Number(process.env.PLATFORM_NOTIF_JOB_INTERVAL_MS || 60_000)
  );
  return {
    timerActive: platformNotifTimer != null,
    running: platformNotifJobRunning,
    intervalMs,
    envEnabled: true
  };
}

/** Send due SCHEDULED platform notifications (global + emergency). */
export async function processScheduledPlatformNotifications(opts?: {
  trigger?: "automatic" | "manual";
  executedBy?: string | null;
}): Promise<number> {
  const trigger = opts?.trigger ?? "automatic";
  if (
    trigger === "automatic" &&
    !(await SchedulerTracking.isJobEnabled(PLATFORM_NOTIF_SCHEDULER_KEY))
  ) {
    await SchedulerTracking.touchHeartbeat(PLATFORM_NOTIF_SCHEDULER_KEY);
    return 0;
  }
  if (platformNotifJobRunning) return 0;
  platformNotifJobRunning = true;
  let sent = 0;
  try {
    const tracked = await SchedulerTracking.trackExecution(
      PLATFORM_NOTIF_SCHEDULER_KEY,
      trigger,
      opts?.executedBy ?? null,
      async () => {
        const due = await PlatformNotification.findAll({
          attributes: ["id", "kind", "title", "body", "audience", "createdBy", "scheduledAt"],
          where: {
            status: "SCHEDULED",
            scheduledAt: { [Op.lte]: now() }
          },
          order: [["scheduled_at", "ASC"]],
          limit: 50
        });

        let count = 0;
        for (const row of due) {
          try {
            // Claim row to avoid duplicate sends across overlapping ticks
            const [claimed] = await PlatformNotification.update(
              { status: "SENT", sentAt: now(), updatedAt: now() } as any,
              { where: { id: row.id, status: "SCHEDULED" } }
            );
            if (!claimed) continue;

            const userIds = await resolveAudienceUserIds(row.audience as PlatformAudience);
            await adminBroadcast({
              title: row.title,
              body: row.body,
              category: row.kind === "EMERGENCY" ? "SYSTEM" : "COMMUNITY",
              userIds,
              persistInApp: true
            });
            await audit(row.createdBy, `${row.kind}_SCHEDULED_SENT`, "notifications", {
              id: row.id,
              scheduledAt: row.scheduledAt?.toISOString() ?? null
            });
            count += 1;
          } catch (e) {
            console.error("[platform-notif-job] failed id=", row.id, e);
            await PlatformNotification.update(
              { status: "SCHEDULED", sentAt: null, updatedAt: now() } as any,
              { where: { id: row.id } }
            ).catch(() => undefined);
          }
        }
        sent = count;
        return { recordsProcessed: count };
      }
    );
    if (!tracked.ok && tracked.error) {
      console.error("[platform-notif-job] failed", tracked.error);
    }
  } finally {
    platformNotifJobRunning = false;
  }
  return sent;
}

export function startPlatformNotificationJobs(): void {
  if (platformNotifTimer) return;
  const intervalMs = Math.max(
    15_000,
    Number(process.env.PLATFORM_NOTIF_JOB_INTERVAL_MS || 60_000)
  );
  setTimeout(() => {
    void processScheduledPlatformNotifications().then((n) => {
      if (n > 0) console.log(`[platform-notif-job] sent ${n} scheduled`);
    });
  }, 20_000);
  platformNotifTimer = setInterval(() => {
    void processScheduledPlatformNotifications().then((n) => {
      if (n > 0) console.log(`[platform-notif-job] sent ${n} scheduled`);
    });
  }, intervalMs);
  console.log(
    `[platform-notif-job] scheduled every ${Math.round(intervalMs / 1000)}s`
  );
}

export function stopPlatformNotificationJobs(): void {
  if (platformNotifTimer) clearInterval(platformNotifTimer);
  platformNotifTimer = null;
}
