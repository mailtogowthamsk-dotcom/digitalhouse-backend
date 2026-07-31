import { PlatformAuditLog } from "../../models";

export function now() {
  return new Date();
}

export function isActiveWindow(startsAt: Date | null, endsAt: Date | null, at = now()) {
  if (startsAt && startsAt > at) return false;
  if (endsAt && endsAt < at) return false;
  return true;
}

export async function audit(
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
