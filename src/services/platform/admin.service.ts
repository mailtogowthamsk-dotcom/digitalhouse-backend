import { Op } from "sequelize";
import {
  PlatformAppVersion,
  PlatformFeatureFlag,
  PlatformAnnouncement,
  PlatformNotification,
  PlatformAd,
  PlatformAuditLog,
  User,
  MatrimonySubscription
} from "../../models";
import { normalizeAuditRow } from "../PlatformConfigAudit.service";
import { ensurePlatformDefaults } from "./platform-setup.service";
import { resolveMaintenance } from "./maintenance.service";
import { now } from "./shared";

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

export async function listAuditLogs(
  page = 1,
  limit = 50,
  module?: string,
  options?: { configOnly?: boolean; action?: string }
) {
  const where: any = {};
  const configModules = [
    "business_settings",
    "maintenance",
    "features",
    "menu",
    "subscriptions",
    "version",
    "settings"
  ];
  if (module) {
    where.module = module;
  } else if (options?.configOnly) {
    where.module = { [Op.in]: configModules };
  }
  if (options?.action) where.action = options.action;
  const offset = (Math.max(1, page) - 1) * limit;
  const { rows, count } = await PlatformAuditLog.findAndCountAll({
    where,
    order: [["createdAt", "DESC"]],
    limit: Math.min(100, limit),
    offset
  });
  const items = rows.map((r) =>
    normalizeAuditRow({
      id: r.id,
      adminEmail: r.adminEmail,
      action: r.action,
      module: r.module,
      detailsJson: r.detailsJson,
      createdAt: r.createdAt
    })
  );
  return {
    items,
    total: count,
    page,
    limit,
    configModules
  };
}
