import { Op } from "sequelize";
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
import { now } from "./shared";

/**
 * Process-local memo: defaults only need to exist once per API process.
 * Previously every /platform/bootstrap did ~20+ serial findOne round-trips.
 */
let defaultsReadyPromise: Promise<void> | null = null;
let defaultsEnsured = false;

/** Ensure singleton maintenance + default flags/menus exist (idempotent, once per process). */
export async function ensurePlatformDefaults(): Promise<void> {
  if (defaultsEnsured) return;
  if (defaultsReadyPromise) return defaultsReadyPromise;

  defaultsReadyPromise = (async () => {
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

    const flagCodes = DEFAULT_FEATURE_FLAGS.map((f) => f.code);
    const existingFlags = await PlatformFeatureFlag.findAll({
      where: { code: { [Op.in]: flagCodes } },
      attributes: ["code"]
    });
    const haveFlag = new Set(existingFlags.map((f) => f.code));
    for (const f of DEFAULT_FEATURE_FLAGS) {
      if (haveFlag.has(f.code)) continue;
      await PlatformFeatureFlag.create({
        code: f.code,
        label: f.label,
        enabled: f.enabled,
        platformsJson: ["ANDROID", "IOS"],
        createdAt: now(),
        updatedAt: now()
      } as any);
    }

    const menuCodes = DEFAULT_MENU_ITEMS.map((m) => m.code);
    const existingMenus = await PlatformMenuItem.findAll({
      where: { code: { [Op.in]: menuCodes } },
      attributes: ["code"]
    });
    const haveMenu = new Set(existingMenus.map((m) => m.code));
    for (const m of DEFAULT_MENU_ITEMS) {
      if (haveMenu.has(m.code)) continue;
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

    defaultsEnsured = true;
  })().catch((err) => {
    defaultsReadyPromise = null;
    throw err;
  });

  return defaultsReadyPromise;
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
