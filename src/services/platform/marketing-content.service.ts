import {
  PlatformAlertPopup,
  PlatformPopupAck,
  PlatformAnnouncement,
  PlatformBanner,
  PlatformAd
} from "../../models";
import { audit, isActiveWindow, now } from "./shared";

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
