import { Op } from "sequelize";
import {
  PlatformAppVersion,
  PlatformMaintenance,
  PlatformNotification,
  PlatformAlertPopup,
  PlatformPopupAck,
  PlatformAnnouncement,
  PlatformBanner,
  PlatformFeatureFlag,
  PlatformMenuItem,
  PlatformAd,
  PlatformAuditLog,
  User,
  MatrimonySubscription
} from "../models";
import {
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_MENU_ITEMS,
  defaultStoreUrl,
  type AppPlatform,
  type PlatformAudience,
  type PlatformNotifKind,
  type VersionStatus
} from "../constants/platform.constants";
import { adminBroadcast } from "./Notification.service";

async function audit(
  adminEmail: string | null,
  action: string,
  module: string,
  details?: Record<string, unknown>
) {
  await PlatformAuditLog.create({
    adminEmail,
    action,
    module,
    detailsJson: details ?? null,
    createdAt: new Date()
  } as any);
}

function now() {
  return new Date();
}

function isActiveWindow(startsAt: Date | null, endsAt: Date | null, at = now()) {
  if (startsAt && startsAt > at) return false;
  if (endsAt && endsAt < at) return false;
  return true;
}

/** Ensure singleton maintenance + default flags/menus exist */
export async function ensurePlatformDefaults(): Promise<void> {
  const maint = await PlatformMaintenance.findOne();
  if (!maint) {
    await PlatformMaintenance.create({
      enabled: false,
      title: "Under Maintenance",
      description: "We will be back shortly.",
      createdAt: now(),
      updatedAt: now()
    } as any);
  }

  for (const f of DEFAULT_FEATURE_FLAGS) {
    const exists = await PlatformFeatureFlag.findOne({ where: { code: f.code } });
    if (!exists) {
      await PlatformFeatureFlag.create({
        code: f.code,
        label: f.label,
        enabled: f.enabled,
        platformsJson: ["ANDROID", "IOS"],
        createdAt: now(),
        updatedAt: now()
      } as any);
    }
  }

  for (const m of DEFAULT_MENU_ITEMS) {
    const exists = await PlatformMenuItem.findOne({ where: { code: m.code } });
    if (!exists) {
      await PlatformMenuItem.create({
        code: m.code,
        label: m.label,
        enabled: m.enabled,
        sortOrder: m.sortOrder,
        featureFlag: m.featureFlag ?? null,
        platformScope: "ALL",
        createdAt: now(),
        updatedAt: now()
      } as any);
    }
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, "").split(".").map((n) => Number(n) || 0);
  const pb = b.replace(/^v/i, "").split(".").map((n) => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

async function resolveMaintenance() {
  const row = await PlatformMaintenance.findOne({ order: [["id", "ASC"]] });
  if (!row) return { enabled: false, title: null, description: null, expectedEndAt: null, contactInfo: null };

  // Auto-activate scheduled maintenance
  if (!row.enabled && row.scheduledStartAt && row.scheduledStartAt <= now()) {
    await row.update({
      enabled: true,
      activatedAt: now(),
      updatedAt: now()
    } as any);
  }

  return {
    enabled: Boolean(row.enabled),
    title: row.title,
    description: row.description,
    expectedEndAt: row.expectedEndAt?.toISOString() ?? null,
    contactInfo: row.contactInfo
  };
}

async function versionPolicyFor(platform: AppPlatform, clientVersion?: string | null) {
  const active = await PlatformAppVersion.findOne({
    where: {
      platform,
      status: { [Op.in]: ["SOFT_UPDATE", "FORCE_UPDATE"] }
    },
    order: [["updatedAt", "DESC"]]
  });

  if (!active) {
    return {
      platform,
      status: "NONE" as const,
      latestVersion: null,
      minSupportedVersion: null,
      releaseNotes: null,
      releaseDate: null,
      storeUrl: defaultStoreUrl(platform),
      updateRequired: false,
      forceUpdate: false,
      softUpdate: false
    };
  }

  const client = (clientVersion || "").trim();
  let forceUpdate = false;
  let softUpdate = false;

  // Hard-block only when client is proven below minSupportedVersion.
  // Never freeze the app solely because a FORCE_UPDATE row exists (Expo Go / missing min).
  if (client && active.minSupportedVersion) {
    if (compareSemver(client, active.minSupportedVersion) < 0) {
      forceUpdate = true;
    } else if (
      active.latestVersion &&
      compareSemver(client, active.latestVersion) < 0 &&
      (active.status === "SOFT_UPDATE" || active.status === "FORCE_UPDATE")
    ) {
      softUpdate = true;
    }
  } else if (active.status === "SOFT_UPDATE" || active.status === "FORCE_UPDATE") {
    softUpdate = true;
  }

  return {
    platform,
    status: active.status,
    latestVersion: active.latestVersion,
    minSupportedVersion: active.minSupportedVersion,
    releaseNotes: active.releaseNotes,
    releaseDate: active.releaseDate,
    versionName: active.versionName,
    storeUrl: active.storeUrl || defaultStoreUrl(platform),
    updateRequired: forceUpdate || softUpdate,
    forceUpdate,
    softUpdate
  };
}

/** Public bootstrap — mobile calls this on launch */
export async function getPlatformBootstrap(opts: {
  platform?: AppPlatform | null;
  appVersion?: string | null;
  userId?: number | null;
}) {
  await ensurePlatformDefaults();
  const platform = opts.platform === "IOS" ? "IOS" : opts.platform === "ANDROID" ? "ANDROID" : null;
  const maintenance = await resolveMaintenance();

  const [flags, menus, announcements, banners, popups, ads, version] = await Promise.all([
    PlatformFeatureFlag.findAll({ order: [["code", "ASC"]] }),
    PlatformMenuItem.findAll({ order: [["sortOrder", "ASC"]] }),
    PlatformAnnouncement.findAll({
      where: {
        isActive: true,
        publishAt: { [Op.lte]: now() },
        [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: now() } }]
      },
      order: [
        ["priority", "DESC"],
        ["publishAt", "DESC"]
      ],
      limit: 20
    }),
    PlatformBanner.findAll({
      where: {
        isActive: true,
        [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: now() } }]
      },
      order: [
        ["priority", "DESC"],
        ["id", "DESC"]
      ],
      limit: 5
    }),
    PlatformAlertPopup.findAll({
      where: {
        isActive: true,
        [Op.and]: [
          { [Op.or]: [{ scheduledAt: null }, { scheduledAt: { [Op.lte]: now() } }] },
          { [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: now() } }] }
        ]
      },
      order: [["id", "DESC"]],
      limit: 10
    }),
    PlatformAd.findAll({
      where: { isActive: true },
      order: [
        ["priority", "DESC"],
        ["id", "DESC"]
      ],
      limit: 20
    }),
    platform ? versionPolicyFor(platform, opts.appVersion) : Promise.resolve(null)
  ]);

  const flagMap: Record<string, boolean> = {};
  for (const f of flags) flagMap[f.code] = Boolean(f.enabled);

  let ackIds = new Set<number>();
  if (opts.userId) {
    const acks = await PlatformPopupAck.findAll({
      where: { userId: opts.userId },
      attributes: ["popupId"]
    });
    ackIds = new Set(acks.map((a) => a.popupId));
  }

  const visibleMenus = menus
    .filter((m) => {
      if (!m.enabled) return false;
      if (m.featureFlag && flagMap[m.featureFlag] === false) return false;
      if (m.platformScope && m.platformScope !== "ALL" && platform && m.platformScope !== platform) {
        return false;
      }
      return true;
    })
    .map((m) => ({
      code: m.code,
      label: m.label,
      sortOrder: m.sortOrder
    }));

  const activeAds = ads.filter((a) => isActiveWindow(a.startsAt, a.endsAt));

  return {
    serverTime: now().toISOString(),
    maintenance,
    version,
    features: flagMap,
    menu: visibleMenus,
    announcements: announcements.map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      bannerImage: a.bannerImage,
      publishAt: a.publishAt.toISOString(),
      expiresAt: a.expiresAt?.toISOString() ?? null,
      priority: a.priority
    })),
    banners: banners.map((b) => ({
      id: b.id,
      message: b.message,
      backgroundColor: b.backgroundColor,
      icon: b.icon,
      clickAction: b.clickAction,
      expiresAt: b.expiresAt?.toISOString() ?? null,
      priority: b.priority
    })),
    popups: popups
      .filter((p) => {
        if (p.popupType === "ONE_TIME" && ackIds.has(p.id)) return false;
        if (p.popupType === "MANDATORY" && ackIds.has(p.id) && !p.acknowledgementRequired) return false;
        if (p.popupType === "MANDATORY" && p.acknowledgementRequired && ackIds.has(p.id)) return false;
        return true;
      })
      .map((p) => ({
        id: p.id,
        title: p.title,
        body: p.body,
        imageUrl: p.imageUrl,
        popupType: p.popupType,
        acknowledgementRequired: Boolean(p.acknowledgementRequired)
      })),
    ads: activeAds.map((a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      imageUrl: a.imageUrl,
      targetScreen: a.targetScreen,
      clickAction: a.clickAction,
      priority: a.priority
    }))
  };
}

export async function acknowledgePopup(userId: number, popupId: number) {
  const popup = await PlatformAlertPopup.findByPk(popupId);
  if (!popup || !popup.isActive) {
    throw Object.assign(new Error("Popup not found"), { status: 404 });
  }
  const [row] = await PlatformPopupAck.findOrCreate({
    where: { popupId, userId },
    defaults: { popupId, userId, acknowledgedAt: now() } as any
  });
  if (!row.acknowledgedAt) await row.update({ acknowledgedAt: now() } as any);
  return { ok: true };
}

export async function trackAdEvent(adId: number, event: "view" | "click") {
  const ad = await PlatformAd.findByPk(adId);
  if (!ad) throw Object.assign(new Error("Ad not found"), { status: 404 });
  if (event === "view") await ad.increment("views");
  else await ad.increment("clicks");
  return { ok: true };
}

// ─── Admin dashboard ───────────────────────────────────────────────

export async function getAdminDashboard() {
  await ensurePlatformDefaults();
  const [
    maintenance,
    versions,
    flags,
    announcements,
    notifs,
    ads,
    activeUsers,
    activeSubs
  ] = await Promise.all([
    resolveMaintenance(),
    PlatformAppVersion.findAll({
      where: { status: { [Op.in]: ["SOFT_UPDATE", "FORCE_UPDATE"] } },
      order: [["platform", "ASC"]]
    }),
    PlatformFeatureFlag.findAll(),
    PlatformAnnouncement.count({
      where: {
        isActive: true,
        publishAt: { [Op.lte]: now() },
        [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: now() } }]
      }
    }),
    PlatformNotification.count({ where: { status: { [Op.in]: ["DRAFT", "SCHEDULED"] } } }),
    PlatformAd.count({ where: { isActive: true } }),
    User.count({ where: { status: "APPROVED" } }),
    MatrimonySubscription.count({ where: { status: "ACTIVE" } }).catch(() => 0)
  ]);

  return {
    maintenance,
    versions: versions.map((v) => ({
      id: v.id,
      platform: v.platform,
      versionName: v.versionName,
      latestVersion: v.latestVersion,
      minSupportedVersion: v.minSupportedVersion,
      status: v.status
    })),
    featuresEnabled: flags.filter((f) => f.enabled).length,
    featuresTotal: flags.length,
    features: flags.map((f) => ({ code: f.code, label: f.label, enabled: f.enabled })),
    pendingAnnouncements: announcements,
    pendingNotifications: notifs,
    activeAds: ads,
    activeUsers,
    activeSubscriptions: activeSubs
  };
}

// ─── Versions ──────────────────────────────────────────────────────

export async function listVersions(platform?: string) {
  const where: any = {};
  if (platform) where.platform = platform;
  const rows = await PlatformAppVersion.findAll({ where, order: [["updatedAt", "DESC"]] });
  return rows.map((v) => ({
    id: v.id,
    platform: v.platform,
    versionName: v.versionName,
    versionCode: v.versionCode,
    minSupportedVersion: v.minSupportedVersion,
    latestVersion: v.latestVersion,
    releaseNotes: v.releaseNotes,
    releaseDate: v.releaseDate,
    storeUrl: v.storeUrl,
    status: v.status,
    createdBy: v.createdBy,
    updatedBy: v.updatedBy,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString()
  }));
}

export async function upsertVersion(
  adminEmail: string | null,
  input: {
    id?: number;
    platform: AppPlatform;
    versionName: string;
    versionCode?: number;
    minSupportedVersion: string;
    latestVersion: string;
    releaseNotes?: string | null;
    releaseDate?: string | null;
    storeUrl?: string | null;
    status: VersionStatus;
  }
) {
  let row: PlatformAppVersion | null = null;
  if (input.id) row = await PlatformAppVersion.findByPk(input.id);

  // Only one active soft/force per platform
  if (input.status === "SOFT_UPDATE" || input.status === "FORCE_UPDATE") {
    await PlatformAppVersion.update(
      { status: "DISABLED", updatedAt: now(), updatedBy: adminEmail } as any,
      {
        where: {
          platform: input.platform,
          status: { [Op.in]: ["SOFT_UPDATE", "FORCE_UPDATE"] },
          ...(row ? { id: { [Op.ne]: row.id } } : {})
        }
      }
    );
  }

  const storeUrl =
    input.storeUrl !== undefined
      ? input.storeUrl?.trim() || null
      : row?.storeUrl ?? defaultStoreUrl(input.platform);

  if (row) {
    await row.update({
      platform: input.platform,
      versionName: input.versionName,
      versionCode: input.versionCode ?? row.versionCode,
      minSupportedVersion: input.minSupportedVersion,
      latestVersion: input.latestVersion,
      releaseNotes: input.releaseNotes ?? null,
      releaseDate: input.releaseDate ?? null,
      storeUrl,
      status: input.status,
      updatedBy: adminEmail,
      updatedAt: now()
    } as any);
  } else {
    row = await PlatformAppVersion.create({
      platform: input.platform,
      versionName: input.versionName,
      versionCode: input.versionCode ?? 0,
      minSupportedVersion: input.minSupportedVersion,
      latestVersion: input.latestVersion,
      releaseNotes: input.releaseNotes ?? null,
      releaseDate: input.releaseDate ?? null,
      storeUrl,
      status: input.status,
      createdBy: adminEmail,
      updatedBy: adminEmail,
      createdAt: now(),
      updatedAt: now()
    } as any);
  }

  await audit(adminEmail, `VERSION_${input.status}`, "version", {
    id: row.id,
    platform: input.platform,
    versionName: input.versionName
  });
  return listVersions();
}

// ─── Maintenance ───────────────────────────────────────────────────

export async function getMaintenanceAdmin() {
  await ensurePlatformDefaults();
  const row = await PlatformMaintenance.findOne({ order: [["id", "ASC"]] });
  return {
    id: row!.id,
    enabled: Boolean(row!.enabled),
    title: row!.title,
    description: row!.description,
    expectedEndAt: row!.expectedEndAt?.toISOString() ?? null,
    contactInfo: row!.contactInfo,
    scheduledStartAt: row!.scheduledStartAt?.toISOString() ?? null,
    activatedAt: row!.activatedAt?.toISOString() ?? null,
    deactivatedAt: row!.deactivatedAt?.toISOString() ?? null,
    updatedBy: row!.updatedBy
  };
}

export async function updateMaintenance(
  adminEmail: string | null,
  patch: {
    enabled?: boolean;
    title?: string;
    description?: string | null;
    expectedEndAt?: string | null;
    contactInfo?: string | null;
    scheduledStartAt?: string | null;
  }
) {
  await ensurePlatformDefaults();
  const row = await PlatformMaintenance.findOne({ order: [["id", "ASC"]] });
  if (!row) throw Object.assign(new Error("Maintenance config missing"), { status: 500 });

  const enabling = patch.enabled === true && !row.enabled;
  const disabling = patch.enabled === false && row.enabled;

  await row.update({
    enabled: patch.enabled ?? row.enabled,
    title: patch.title ?? row.title,
    description: patch.description !== undefined ? patch.description : row.description,
    expectedEndAt:
      patch.expectedEndAt !== undefined
        ? patch.expectedEndAt
          ? new Date(patch.expectedEndAt)
          : null
        : row.expectedEndAt,
    contactInfo: patch.contactInfo !== undefined ? patch.contactInfo : row.contactInfo,
    scheduledStartAt:
      patch.scheduledStartAt !== undefined
        ? patch.scheduledStartAt
          ? new Date(patch.scheduledStartAt)
          : null
        : row.scheduledStartAt,
    activatedAt: enabling ? now() : row.activatedAt,
    deactivatedAt: disabling ? now() : row.deactivatedAt,
    updatedBy: adminEmail,
    updatedAt: now()
  } as any);

  await audit(
    adminEmail,
    enabling ? "MAINTENANCE_ENABLED" : disabling ? "MAINTENANCE_DISABLED" : "MAINTENANCE_UPDATED",
    "maintenance",
    { enabled: row.enabled }
  );
  return getMaintenanceAdmin();
}

// ─── Notifications (global + emergency) ────────────────────────────

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

// ─── Popups / Announcements / Banners / Flags / Menu / Ads ─────────

function mapPopup(p: PlatformAlertPopup) {
  return {
    id: p.id,
    title: p.title,
    body: p.body,
    imageUrl: p.imageUrl,
    popupType: p.popupType,
    acknowledgementRequired: Boolean(p.acknowledgementRequired),
    scheduledAt: p.scheduledAt?.toISOString() ?? null,
    expiresAt: p.expiresAt?.toISOString() ?? null,
    isActive: Boolean(p.isActive),
    createdBy: p.createdBy,
    createdAt: p.createdAt.toISOString()
  };
}

export async function listPopups() {
  const rows = await PlatformAlertPopup.findAll({ order: [["createdAt", "DESC"]], limit: 100 });
  return rows.map(mapPopup);
}

export async function savePopup(
  adminEmail: string | null,
  input: Partial<{
    id: number;
    title: string;
    body: string;
    imageUrl: string | null;
    popupType: string;
    acknowledgementRequired: boolean;
    scheduledAt: string | null;
    expiresAt: string | null;
    isActive: boolean;
  }>
) {
  let row: PlatformAlertPopup | null = input.id ? await PlatformAlertPopup.findByPk(input.id) : null;
  const payload = {
    title: input.title?.trim() || row?.title || "Alert",
    body: input.body?.trim() || row?.body || "",
    imageUrl: input.imageUrl !== undefined ? input.imageUrl : row?.imageUrl ?? null,
    popupType: input.popupType || row?.popupType || "ONE_TIME",
    acknowledgementRequired:
      input.acknowledgementRequired ?? row?.acknowledgementRequired ?? false,
    scheduledAt:
      input.scheduledAt !== undefined
        ? input.scheduledAt
          ? new Date(input.scheduledAt)
          : null
        : row?.scheduledAt ?? null,
    expiresAt:
      input.expiresAt !== undefined
        ? input.expiresAt
          ? new Date(input.expiresAt)
          : null
        : row?.expiresAt ?? null,
    isActive: input.isActive ?? row?.isActive ?? true,
    updatedAt: now()
  };

  if (row) {
    await row.update(payload as any);
  } else {
    row = await PlatformAlertPopup.create({
      ...payload,
      createdBy: adminEmail,
      createdAt: now()
    } as any);
  }
  await audit(adminEmail, row ? "POPUP_SAVED" : "POPUP_CREATED", "popups", { id: row.id });
  return mapPopup(row);
}

export async function listAnnouncements() {
  const rows = await PlatformAnnouncement.findAll({ order: [["publishAt", "DESC"]], limit: 100 });
  return rows.map((a) => ({
    id: a.id,
    title: a.title,
    description: a.description,
    bannerImage: a.bannerImage,
    publishAt: a.publishAt.toISOString(),
    expiresAt: a.expiresAt?.toISOString() ?? null,
    priority: a.priority,
    isActive: Boolean(a.isActive),
    createdBy: a.createdBy
  }));
}

export async function saveAnnouncement(
  adminEmail: string | null,
  input: Partial<{
    id: number;
    title: string;
    description: string;
    bannerImage: string | null;
    publishAt: string;
    expiresAt: string | null;
    priority: number;
    isActive: boolean;
  }>
) {
  let row = input.id ? await PlatformAnnouncement.findByPk(input.id) : null;
  const payload = {
    title: input.title?.trim() || row?.title || "Announcement",
    description: input.description?.trim() || row?.description || "",
    bannerImage: input.bannerImage !== undefined ? input.bannerImage : row?.bannerImage ?? null,
    publishAt: input.publishAt ? new Date(input.publishAt) : row?.publishAt || now(),
    expiresAt:
      input.expiresAt !== undefined
        ? input.expiresAt
          ? new Date(input.expiresAt)
          : null
        : row?.expiresAt ?? null,
    priority: input.priority ?? row?.priority ?? 0,
    isActive: input.isActive ?? row?.isActive ?? true,
    updatedAt: now()
  };
  if (row) await row.update(payload as any);
  else
    row = await PlatformAnnouncement.create({
      ...payload,
      createdBy: adminEmail,
      createdAt: now()
    } as any);
  await audit(adminEmail, "ANNOUNCEMENT_SAVED", "announcements", { id: row.id });
  return row;
}

export async function listBanners() {
  const rows = await PlatformBanner.findAll({ order: [["priority", "DESC"]], limit: 100 });
  return rows.map((b) => ({
    id: b.id,
    message: b.message,
    backgroundColor: b.backgroundColor,
    icon: b.icon,
    clickAction: b.clickAction,
    expiresAt: b.expiresAt?.toISOString() ?? null,
    priority: b.priority,
    isActive: Boolean(b.isActive)
  }));
}

export async function saveBanner(
  adminEmail: string | null,
  input: Partial<{
    id: number;
    message: string;
    backgroundColor: string | null;
    icon: string | null;
    clickAction: string | null;
    expiresAt: string | null;
    priority: number;
    isActive: boolean;
  }>
) {
  let row = input.id ? await PlatformBanner.findByPk(input.id) : null;
  const payload = {
    message: input.message?.trim() || row?.message || "",
    backgroundColor:
      input.backgroundColor !== undefined ? input.backgroundColor : row?.backgroundColor ?? "#0f172a",
    icon: input.icon !== undefined ? input.icon : row?.icon ?? null,
    clickAction: input.clickAction !== undefined ? input.clickAction : row?.clickAction ?? null,
    expiresAt:
      input.expiresAt !== undefined
        ? input.expiresAt
          ? new Date(input.expiresAt)
          : null
        : row?.expiresAt ?? null,
    priority: input.priority ?? row?.priority ?? 0,
    isActive: input.isActive ?? row?.isActive ?? true,
    updatedAt: now()
  };
  if (row) await row.update(payload as any);
  else
    row = await PlatformBanner.create({
      ...payload,
      createdBy: adminEmail,
      createdAt: now()
    } as any);
  await audit(adminEmail, "BANNER_SAVED", "banners", { id: row.id });
  return row;
}

export async function listFeatureFlags() {
  await ensurePlatformDefaults();
  const rows = await PlatformFeatureFlag.findAll({ order: [["code", "ASC"]] });
  return rows.map((f) => ({
    id: f.id,
    code: f.code,
    label: f.label,
    enabled: Boolean(f.enabled),
    platforms: f.platformsJson,
    updatedBy: f.updatedBy,
    updatedAt: f.updatedAt.toISOString()
  }));
}

export async function setFeatureFlag(
  adminEmail: string | null,
  code: string,
  enabled: boolean
) {
  await ensurePlatformDefaults();
  const row = await PlatformFeatureFlag.findOne({ where: { code } });
  if (!row) throw Object.assign(new Error("Feature flag not found"), { status: 404 });
  await row.update({ enabled, updatedBy: adminEmail, updatedAt: now() } as any);
  await audit(adminEmail, enabled ? "FEATURE_ENABLED" : "FEATURE_DISABLED", "features", { code });
  return listFeatureFlags();
}

export async function listMenuItems() {
  await ensurePlatformDefaults();
  const rows = await PlatformMenuItem.findAll({ order: [["sortOrder", "ASC"]] });
  return rows.map((m) => ({
    id: m.id,
    code: m.code,
    label: m.label,
    enabled: Boolean(m.enabled),
    sortOrder: m.sortOrder,
    featureFlag: m.featureFlag,
    platformScope: m.platformScope,
    roleScope: m.roleScope
  }));
}

export async function setMenuItem(
  adminEmail: string | null,
  code: string,
  patch: { enabled?: boolean; sortOrder?: number; label?: string; platformScope?: string | null }
) {
  await ensurePlatformDefaults();
  const row = await PlatformMenuItem.findOne({ where: { code } });
  if (!row) throw Object.assign(new Error("Menu item not found"), { status: 404 });
  await row.update({
    enabled: patch.enabled ?? row.enabled,
    sortOrder: patch.sortOrder ?? row.sortOrder,
    label: patch.label ?? row.label,
    platformScope: patch.platformScope !== undefined ? patch.platformScope : row.platformScope,
    updatedBy: adminEmail,
    updatedAt: now()
  } as any);
  await audit(adminEmail, "MENU_UPDATED", "menu", { code, enabled: row.enabled });
  return listMenuItems();
}

export async function listAds() {
  const rows = await PlatformAd.findAll({ order: [["priority", "DESC"]], limit: 100 });
  return rows.map((a) => ({
    id: a.id,
    kind: a.kind,
    title: a.title,
    imageUrl: a.imageUrl,
    targetScreen: a.targetScreen,
    priority: a.priority,
    startsAt: a.startsAt?.toISOString() ?? null,
    endsAt: a.endsAt?.toISOString() ?? null,
    clickAction: a.clickAction,
    isActive: Boolean(a.isActive),
    views: a.views,
    clicks: a.clicks,
    ctr: a.views > 0 ? Number(((a.clicks / a.views) * 100).toFixed(2)) : 0
  }));
}

export async function saveAd(
  adminEmail: string | null,
  input: Partial<{
    id: number;
    kind: string;
    title: string;
    imageUrl: string | null;
    targetScreen: string | null;
    priority: number;
    startsAt: string | null;
    endsAt: string | null;
    clickAction: string | null;
    isActive: boolean;
  }>
) {
  let row = input.id ? await PlatformAd.findByPk(input.id) : null;
  const payload = {
    kind: input.kind || row?.kind || "BANNER",
    title: input.title?.trim() || row?.title || "Ad",
    imageUrl: input.imageUrl !== undefined ? input.imageUrl : row?.imageUrl ?? null,
    targetScreen: input.targetScreen !== undefined ? input.targetScreen : row?.targetScreen ?? null,
    priority: input.priority ?? row?.priority ?? 0,
    startsAt:
      input.startsAt !== undefined
        ? input.startsAt
          ? new Date(input.startsAt)
          : null
        : row?.startsAt ?? null,
    endsAt:
      input.endsAt !== undefined
        ? input.endsAt
          ? new Date(input.endsAt)
          : null
        : row?.endsAt ?? null,
    clickAction: input.clickAction !== undefined ? input.clickAction : row?.clickAction ?? null,
    isActive: input.isActive ?? row?.isActive ?? true,
    updatedAt: now()
  };
  if (row) await row.update(payload as any);
  else
    row = await PlatformAd.create({
      ...payload,
      views: 0,
      clicks: 0,
      createdBy: adminEmail,
      createdAt: now()
    } as any);
  await audit(adminEmail, "AD_SAVED", "ads", { id: row.id });
  return listAds();
}

export async function getAdAnalytics() {
  const rows = await PlatformAd.findAll();
  const active = rows.filter((a) => a.isActive && isActiveWindow(a.startsAt, a.endsAt));
  const expired = rows.filter((a) => a.endsAt && a.endsAt < now());
  const totalViews = rows.reduce((s, a) => s + a.views, 0);
  const totalClicks = rows.reduce((s, a) => s + a.clicks, 0);
  return {
    totalCampaigns: rows.length,
    activeCampaigns: active.length,
    expiredCampaigns: expired.length,
    totalViews,
    totalClicks,
    ctr: totalViews > 0 ? Number(((totalClicks / totalViews) * 100).toFixed(2)) : 0,
    campaigns: rows.map((a) => ({
      id: a.id,
      title: a.title,
      kind: a.kind,
      views: a.views,
      clicks: a.clicks,
      ctr: a.views > 0 ? Number(((a.clicks / a.views) * 100).toFixed(2)) : 0,
      isActive: a.isActive
    }))
  };
}

export async function listAuditLogs(page = 1, limit = 50, module?: string) {
  const where: any = {};
  if (module) where.module = module;
  const offset = (Math.max(1, page) - 1) * limit;
  const { rows, count } = await PlatformAuditLog.findAndCountAll({
    where,
    order: [["createdAt", "DESC"]],
    limit: Math.min(100, limit),
    offset
  });
  return {
    items: rows.map((r) => ({
      id: r.id,
      adminEmail: r.adminEmail,
      action: r.action,
      module: r.module,
      details: r.detailsJson,
      createdAt: r.createdAt.toISOString()
    })),
    total: count,
    page,
    limit
  };
}

// ─── Scheduled notification worker ─────────────────────────────────

let platformNotifJobRunning = false;
let platformNotifTimer: ReturnType<typeof setInterval> | null = null;

/** Send due SCHEDULED platform notifications (global + emergency). */
export async function processScheduledPlatformNotifications(): Promise<number> {
  if (platformNotifJobRunning) return 0;
  platformNotifJobRunning = true;
  let sent = 0;
  try {
    const due = await PlatformNotification.findAll({
      where: {
        status: "SCHEDULED",
        scheduledAt: { [Op.lte]: now() }
      },
      order: [["scheduledAt", "ASC"]],
      limit: 50
    });

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
        sent += 1;
      } catch (e) {
        console.error("[platform-notif-job] failed id=", row.id, e);
        await PlatformNotification.update(
          { status: "SCHEDULED", sentAt: null, updatedAt: now() } as any,
          { where: { id: row.id } }
        ).catch(() => undefined);
      }
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
