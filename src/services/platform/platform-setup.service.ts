import {
  PlatformMaintenance,
  PlatformFeatureFlag,
  PlatformMenuItem
} from "../../models";
import {
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_MENU_ITEMS
} from "../../constants/platform.constants";
import { recordConfigChange } from "../PlatformConfigAudit.service";
import { audit, now } from "./shared";

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
  const oldEnabled = Boolean(row.enabled);
  await row.update({ enabled, updatedBy: adminEmail, updatedAt: now() } as any);
  await recordConfigChange({
    action: enabled ? "FEATURE_ENABLED" : "FEATURE_DISABLED",
    auditModule: "features",
    settingModule: "platform",
    setting: code,
    oldValue: oldEnabled,
    newValue: enabled,
    changedBy: adminEmail,
    meta: { label: row.label }
  });
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
  const oldValue = {
    enabled: Boolean(row.enabled),
    sortOrder: row.sortOrder,
    label: row.label,
    platformScope: row.platformScope
  };
  await row.update({
    enabled: patch.enabled ?? row.enabled,
    sortOrder: patch.sortOrder ?? row.sortOrder,
    label: patch.label ?? row.label,
    platformScope: patch.platformScope !== undefined ? patch.platformScope : row.platformScope,
    updatedBy: adminEmail,
    updatedAt: now()
  } as any);
  const newValue = {
    enabled: Boolean(row.enabled),
    sortOrder: row.sortOrder,
    label: row.label,
    platformScope: row.platformScope
  };
  await recordConfigChange({
    action: "MENU_UPDATED",
    auditModule: "menu",
    settingModule: "platform",
    setting: code,
    oldValue,
    newValue,
    changedBy: adminEmail
  });
  return listMenuItems();
}
