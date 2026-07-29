/**
 * Platform configuration audit — durable old→new history for Business Control Center.
 * Append-only via platform_audit_logs; never deletes prior configuration history.
 */

import { PlatformAuditLog } from "../models";

export type ConfigAuditDetails = {
  /** Domain module (marketplace, jobs, subscriptions, features, …) */
  module: string;
  /** Setting key or resource code */
  setting: string;
  oldValue: unknown;
  newValue: unknown;
  changedBy: string | null;
  timestamp: string;
  /** Extra context (valueType, id, …) — never replaces the core fields above */
  meta?: Record<string, unknown>;
};

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => (v === undefined ? null : v));
  } catch {
    return String(value);
  }
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/**
 * Persist a configuration change. Always writes; callers may skip when valuesEqual.
 */
export async function recordConfigChange(input: {
  action: string;
  /** Audit log module column (e.g. business_settings, maintenance, features) */
  auditModule: string;
  settingModule: string;
  setting: string;
  oldValue: unknown;
  newValue: unknown;
  changedBy: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const timestamp = new Date().toISOString();
  const details: ConfigAuditDetails = {
    module: input.settingModule,
    setting: input.setting,
    oldValue: input.oldValue,
    newValue: input.newValue,
    changedBy: input.changedBy,
    timestamp,
    ...(input.meta ? { meta: input.meta } : {})
  };

  await PlatformAuditLog.create({
    adminEmail: input.changedBy,
    action: input.action,
    module: input.auditModule,
    detailsJson: details as unknown as Record<string, unknown>,
    createdAt: new Date()
  } as any);
}

export type NormalizedAuditItem = {
  id: number;
  adminEmail: string | null;
  action: string;
  module: string;
  details: Record<string, unknown> | null;
  createdAt: string;
  /** Normalized config-change fields when present */
  settingModule: string | null;
  setting: string | null;
  oldValue: unknown;
  newValue: unknown;
  changedBy: string | null;
  isConfigChange: boolean;
};

export function normalizeAuditRow(row: {
  id: number;
  adminEmail: string | null;
  action: string;
  module: string;
  detailsJson: Record<string, unknown> | null;
  createdAt: Date;
}): NormalizedAuditItem {
  const details = row.detailsJson ?? null;
  const settingModule =
    details && typeof details.module === "string"
      ? details.module
      : details && typeof (details as any).settingModule === "string"
        ? ((details as any).settingModule as string)
        : null;
  const setting =
    details && typeof details.setting === "string"
      ? details.setting
      : details && typeof details.settingKey === "string"
        ? (details.settingKey as string)
        : details && typeof details.code === "string"
          ? (details.code as string)
          : null;
  const hasOld = details != null && "oldValue" in details;
  const hasNew = details != null && "newValue" in details;
  const isConfigChange = Boolean(setting || hasOld || hasNew);

  return {
    id: row.id,
    adminEmail: row.adminEmail,
    action: row.action,
    module: row.module,
    details,
    createdAt: row.createdAt.toISOString(),
    settingModule,
    setting,
    oldValue: hasOld ? details!.oldValue : null,
    newValue: hasNew ? details!.newValue : null,
    changedBy:
      (details && typeof details.changedBy === "string" ? details.changedBy : null) ||
      row.adminEmail,
    isConfigChange
  };
}
