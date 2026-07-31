import { Op } from "sequelize";
import {
  PlatformFeatureFlag,
  PlatformMenuItem,
  PlatformAnnouncement,
  PlatformBanner,
  PlatformAlertPopup,
  PlatformPopupAck,
  PlatformAd
} from "../../models";
import { type AppPlatform } from "../../constants/platform.constants";
import { ensurePlatformDefaults } from "./platform-setup.service";
import { resolveMaintenance } from "./maintenance.service";
import { versionPolicyFor } from "./versions.service";
import { isActiveWindow, now } from "./shared";

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
