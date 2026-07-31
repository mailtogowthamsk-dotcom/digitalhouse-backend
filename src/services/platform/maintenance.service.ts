import { PlatformMaintenance } from "../../models";
import { recordConfigChange } from "../PlatformConfigAudit.service";
import { ensurePlatformDefaults } from "./platform-setup.service";
import { now } from "./shared";

export async function resolveMaintenance() {
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
  const oldValue = {
    enabled: Boolean(row.enabled),
    title: row.title,
    description: row.description,
    expectedEndAt: row.expectedEndAt?.toISOString() ?? null,
    contactInfo: row.contactInfo,
    scheduledStartAt: row.scheduledStartAt?.toISOString() ?? null
  };

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

  const newValue = {
    enabled: Boolean(row.enabled),
    title: row.title,
    description: row.description,
    expectedEndAt: row.expectedEndAt?.toISOString() ?? null,
    contactInfo: row.contactInfo,
    scheduledStartAt: row.scheduledStartAt?.toISOString() ?? null
  };

  await recordConfigChange({
    action: enabling
      ? "MAINTENANCE_ENABLED"
      : disabling
        ? "MAINTENANCE_DISABLED"
        : "MAINTENANCE_UPDATED",
    auditModule: "maintenance",
    settingModule: "platform",
    setting: "maintenance",
    oldValue,
    newValue,
    changedBy: adminEmail
  });
  return getMaintenanceAdmin();
}
