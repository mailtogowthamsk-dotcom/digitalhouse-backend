import { Op } from "sequelize";
import { Advertisement, AdvertisementEntitlement, AdvertisementModerationLog } from "../../models/Advertisement.models";
import * as SchedulerTracking from "../SystemSchedulerTracking.service";
import * as Notifications from "../Notification.service";
import { assertTransition } from "./AdvertisementState.service";

const JOB_INTERVAL_MS = Number(process.env.ADVERTISEMENT_LIFECYCLE_JOB_INTERVAL_MS || 15 * 60 * 1000);
const JOB_ENABLED = process.env.ADVERTISEMENT_LIFECYCLE_JOB_ENABLED !== "false";
const SCHEDULER_JOB_KEY = "advertisement_lifecycle" as const;

let jobTimer: ReturnType<typeof setInterval> | null = null;
let jobRunning = false;

export function getAdvertisementLifecycleJobRuntimeStatus() {
  return {
    timerActive: jobTimer != null,
    running: jobRunning,
    intervalMs: JOB_INTERVAL_MS,
    envEnabled: JOB_ENABLED
  };
}

export async function activateDueScheduled(now = new Date()): Promise<number> {
  const due = await Advertisement.findAll({
    where: {
      status: "SCHEDULED",
      scheduledStartAt: { [Op.lte]: now },
      scheduledEndAt: { [Op.gt]: now }
    },
    limit: 200
  });
  let count = 0;
  for (const ad of due) {
    try {
      assertTransition(ad.status, "ACTIVE");
      ad.status = "ACTIVE";
      ad.actualStartAt = now;
      ad.updatedAt = now;
      await ad.save();
      void Notifications.notifyAdvertisementActivated(ad.userId, ad.id, ad.title).catch(() => {});
      count += 1;
    } catch (err) {
      console.error("[advertisement] activate failed", { id: ad.id, err });
    }
  }
  return count;
}

export async function expireDueCampaigns(now = new Date()): Promise<number> {
  const due = await Advertisement.findAll({
    where: {
      status: { [Op.in]: ["ACTIVE", "PAUSED", "SCHEDULED"] },
      scheduledEndAt: { [Op.lte]: now }
    },
    limit: 200
  });
  let count = 0;
  for (const ad of due) {
    try {
      assertTransition(ad.status, "EXPIRED");
      ad.status = "EXPIRED";
      ad.expiredAt = now;
      ad.actualEndAt = now;
      ad.updatedAt = now;
      await ad.save();
      const entitlement = await AdvertisementEntitlement.findOne({
        where: { advertisementId: ad.id }
      });
      if (entitlement && entitlement.status === "ACTIVE") {
        await entitlement.update({ status: "EXPIRED", updatedAt: now });
      }
      void Notifications.notifyAdvertisementExpired(ad.userId, ad.id, ad.title).catch(() => {});
      count += 1;
    } catch (err) {
      console.error("[advertisement] expire failed", { id: ad.id, err });
    }
  }
  return count;
}

export async function notifyExpiringSoon(now = new Date()): Promise<number> {
  const inOneDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const rows = await Advertisement.findAll({
    where: {
      status: { [Op.in]: ["ACTIVE", "PAUSED"] },
      scheduledEndAt: { [Op.gt]: now, [Op.lte]: inOneDay }
    },
    limit: 200
  });
  let count = 0;
  for (const ad of rows) {
    const already = await AdvertisementModerationLog.findOne({
      where: { advertisementId: ad.id, action: "EXPIRE_SOON_NOTIFIED" },
      attributes: ["id"]
    });
    if (already) continue;
    await AdvertisementModerationLog.create({
      advertisementId: ad.id,
      actor: "system",
      action: "EXPIRE_SOON_NOTIFIED",
      fromStatus: ad.status,
      toStatus: ad.status,
      reason: "Campaign ends within 24 hours",
      createdAt: now
    });
    void Notifications.notifyAdvertisementExpiringSoon(ad.userId, ad.id, ad.title).catch(() => {});
    count += 1;
  }
  return count;
}

export async function runAdvertisementLifecycleJobs(opts?: {
  trigger?: "automatic" | "manual";
  executedBy?: string | null;
}): Promise<void> {
  const trigger = opts?.trigger ?? "automatic";
  if (trigger === "automatic") {
    const enabled = await SchedulerTracking.isJobEnabled(SCHEDULER_JOB_KEY);
    if (!enabled) return;
  }
  if (jobRunning) return;
  jobRunning = true;
  try {
    const tracked = await SchedulerTracking.trackExecution(
      SCHEDULER_JOB_KEY,
      trigger,
      opts?.executedBy ?? null,
      async () => {
        const activated = await activateDueScheduled();
        const expired = await expireDueCampaigns();
        const expiring = await notifyExpiringSoon();
        if (activated || expired || expiring) {
          console.log("[advertisement-lifecycle]", { activated, expired, expiring });
        }
        return { recordsProcessed: activated + expired + expiring };
      }
    );
    if (!tracked.ok && tracked.error) {
      console.error("[advertisement-lifecycle] failed", tracked.error);
    }
  } finally {
    jobRunning = false;
  }
}

export function startAdvertisementLifecycleJobs(): void {
  if (!JOB_ENABLED) {
    console.log("[advertisement-lifecycle] disabled");
    return;
  }
  if (jobTimer) return;
  void runAdvertisementLifecycleJobs();
  jobTimer = setInterval(() => void runAdvertisementLifecycleJobs(), JOB_INTERVAL_MS);
  console.log(
    `[advertisement-lifecycle] scheduled every ${Math.round(JOB_INTERVAL_MS / 60000)} min`
  );
}

export function stopAdvertisementLifecycleJobs(): void {
  if (jobTimer) clearInterval(jobTimer);
  jobTimer = null;
}
