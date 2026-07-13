import type { Request, Response } from "express";
import { z } from "zod";
import { error, success } from "../utils/response";
import * as Platform from "../services/Platform.service";
import {
  APP_PLATFORMS,
  PLATFORM_AUDIENCES,
  PLATFORM_NOTIF_KINDS,
  POPUP_TYPES,
  VERSION_STATUSES,
  AD_KINDS
} from "../constants/platform.constants";

function adminEmail(req: Request): string | null {
  const e = (req as any).adminEmail;
  return typeof e === "string" ? e : null;
}

export async function bootstrap(req: Request, res: Response) {
  const platformRaw = String(req.query.platform || "").toUpperCase();
  const platform =
    platformRaw === "IOS" || platformRaw === "ANDROID" ? (platformRaw as "IOS" | "ANDROID") : null;
  const appVersion = typeof req.query.appVersion === "string" ? req.query.appVersion : null;
  const userId = (req as any).user?.id ?? null;
  const data = await Platform.getPlatformBootstrap({ platform, appVersion, userId });
  return success(res, data);
}

export async function ackPopup(req: Request, res: Response) {
  const userId = (req as any).user?.id;
  if (!userId) return error(res, "Unauthorized", 401);
  const popupId = Number(req.params.id);
  if (!popupId) return error(res, "Invalid popup id", 400);
  try {
    const result = await Platform.acknowledgePopup(userId, popupId);
    return success(res, result);
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function adEvent(req: Request, res: Response) {
  const adId = Number(req.params.id);
  const event = String(req.body?.event || req.query.event || "");
  if (!adId || (event !== "view" && event !== "click")) {
    return error(res, "Invalid ad event", 400);
  }
  try {
    const result = await Platform.trackAdEvent(adId, event);
    return success(res, result);
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function dashboard(_req: Request, res: Response) {
  const data = await Platform.getAdminDashboard();
  return success(res, data);
}

export async function listVersions(req: Request, res: Response) {
  const platform = typeof req.query.platform === "string" ? req.query.platform : undefined;
  const versions = await Platform.listVersions(platform);
  return success(res, { versions });
}

export async function saveVersion(req: Request, res: Response) {
  const body = z
    .object({
      id: z.number().int().positive().optional(),
      platform: z.enum(APP_PLATFORMS as unknown as [string, ...string[]]),
      versionName: z.string().trim().min(1).max(32),
      versionCode: z.number().int().min(0).optional(),
      minSupportedVersion: z.string().trim().min(1).max(32),
      latestVersion: z.string().trim().min(1).max(32),
      releaseNotes: z.string().trim().max(5000).nullable().optional(),
      releaseDate: z.string().trim().max(32).nullable().optional(),
      storeUrl: z.string().trim().url().max(500).nullable().optional().or(z.literal("")),
      status: z.enum(VERSION_STATUSES as unknown as [string, ...string[]])
    })
    .parse(req.body ?? {});
  const versions = await Platform.upsertVersion(adminEmail(req), {
    ...body,
    storeUrl: body.storeUrl || null
  } as any);
  return success(res, { versions });
}

export async function getMaintenance(_req: Request, res: Response) {
  const maintenance = await Platform.getMaintenanceAdmin();
  return success(res, { maintenance });
}

export async function updateMaintenance(req: Request, res: Response) {
  const body = z
    .object({
      enabled: z.boolean().optional(),
      title: z.string().trim().min(1).max(160).optional(),
      description: z.string().trim().max(2000).nullable().optional(),
      expectedEndAt: z.string().nullable().optional(),
      contactInfo: z.string().trim().max(255).nullable().optional(),
      scheduledStartAt: z.string().nullable().optional()
    })
    .parse(req.body ?? {});
  const maintenance = await Platform.updateMaintenance(adminEmail(req), body);
  return success(res, { maintenance });
}

export async function listNotifications(req: Request, res: Response) {
  const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
  const notifications = await Platform.listPlatformNotifications(kind);
  return success(res, { notifications });
}

export async function createNotification(req: Request, res: Response) {
  const body = z
    .object({
      kind: z.enum(PLATFORM_NOTIF_KINDS as unknown as [string, ...string[]]),
      title: z.string().trim().min(1).max(160),
      body: z.string().trim().min(1).max(4000),
      imageUrl: z.string().url().nullable().optional().or(z.literal("")),
      deepLink: z.string().trim().max(500).nullable().optional(),
      audience: z.enum(PLATFORM_AUDIENCES as unknown as [string, ...string[]]).optional(),
      scheduledAt: z.string().nullable().optional(),
      sendNow: z.boolean().optional()
    })
    .parse(req.body ?? {});
  try {
    const result = await Platform.createPlatformNotification(adminEmail(req), {
      ...body,
      imageUrl: body.imageUrl || null,
      kind: body.kind as any,
      audience: body.audience as any
    });
    return success(res, result, 201);
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function sendNotification(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!id) return error(res, "Invalid id", 400);
  try {
    const result = await Platform.sendPlatformNotification(adminEmail(req), id);
    return success(res, result);
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function processScheduledNotifications(_req: Request, res: Response) {
  const sent = await Platform.processScheduledPlatformNotifications();
  return success(res, { sent });
}

export async function listPopups(_req: Request, res: Response) {
  return success(res, { popups: await Platform.listPopups() });
}

export async function savePopup(req: Request, res: Response) {
  const body = z
    .object({
      id: z.number().int().positive().optional(),
      title: z.string().trim().min(1).max(160).optional(),
      body: z.string().trim().min(1).max(4000).optional(),
      imageUrl: z.string().nullable().optional(),
      popupType: z.enum(POPUP_TYPES as unknown as [string, ...string[]]).optional(),
      acknowledgementRequired: z.boolean().optional(),
      scheduledAt: z.string().nullable().optional(),
      expiresAt: z.string().nullable().optional(),
      isActive: z.boolean().optional()
    })
    .parse(req.body ?? {});
  const popup = await Platform.savePopup(adminEmail(req), body);
  return success(res, { popup });
}

export async function listAnnouncements(_req: Request, res: Response) {
  return success(res, { announcements: await Platform.listAnnouncements() });
}

export async function saveAnnouncement(req: Request, res: Response) {
  const body = z
    .object({
      id: z.number().int().positive().optional(),
      title: z.string().trim().min(1).max(160).optional(),
      description: z.string().trim().min(1).max(5000).optional(),
      bannerImage: z.string().nullable().optional(),
      publishAt: z.string().optional(),
      expiresAt: z.string().nullable().optional(),
      priority: z.number().int().optional(),
      isActive: z.boolean().optional()
    })
    .parse(req.body ?? {});
  const announcement = await Platform.saveAnnouncement(adminEmail(req), body);
  return success(res, { announcement });
}

export async function listBanners(_req: Request, res: Response) {
  return success(res, { banners: await Platform.listBanners() });
}

export async function saveBanner(req: Request, res: Response) {
  const body = z
    .object({
      id: z.number().int().positive().optional(),
      message: z.string().trim().min(1).max(255).optional(),
      backgroundColor: z.string().nullable().optional(),
      icon: z.string().nullable().optional(),
      clickAction: z.string().nullable().optional(),
      expiresAt: z.string().nullable().optional(),
      priority: z.number().int().optional(),
      isActive: z.boolean().optional()
    })
    .parse(req.body ?? {});
  const banner = await Platform.saveBanner(adminEmail(req), body);
  return success(res, { banner });
}

export async function listFeatures(_req: Request, res: Response) {
  return success(res, { features: await Platform.listFeatureFlags() });
}

export async function setFeature(req: Request, res: Response) {
  const code = String(req.params.code || "");
  const body = z.object({ enabled: z.boolean() }).parse(req.body ?? {});
  try {
    const features = await Platform.setFeatureFlag(adminEmail(req), code, body.enabled);
    return success(res, { features });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function listMenu(_req: Request, res: Response) {
  return success(res, { menu: await Platform.listMenuItems() });
}

export async function setMenu(req: Request, res: Response) {
  const code = String(req.params.code || "");
  const body = z
    .object({
      enabled: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
      label: z.string().trim().min(1).max(120).optional(),
      platformScope: z.string().nullable().optional()
    })
    .parse(req.body ?? {});
  try {
    const menu = await Platform.setMenuItem(adminEmail(req), code, body);
    return success(res, { menu });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function listAds(_req: Request, res: Response) {
  return success(res, { ads: await Platform.listAds() });
}

export async function saveAd(req: Request, res: Response) {
  const body = z
    .object({
      id: z.number().int().positive().optional(),
      kind: z.enum(AD_KINDS as unknown as [string, ...string[]]).optional(),
      title: z.string().trim().min(1).max(160).optional(),
      imageUrl: z.string().nullable().optional(),
      targetScreen: z.string().nullable().optional(),
      priority: z.number().int().optional(),
      startsAt: z.string().nullable().optional(),
      endsAt: z.string().nullable().optional(),
      clickAction: z.string().nullable().optional(),
      isActive: z.boolean().optional()
    })
    .parse(req.body ?? {});
  const ads = await Platform.saveAd(adminEmail(req), body);
  return success(res, { ads });
}

export async function adAnalytics(_req: Request, res: Response) {
  return success(res, await Platform.getAdAnalytics());
}

export async function listAudits(req: Request, res: Response) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const module = typeof req.query.module === "string" ? req.query.module : undefined;
  const data = await Platform.listAuditLogs(page, limit, module);
  return success(res, data);
}
