/**
 * Matrimony profile visibility lifecycle (approved profiles only).
 * Workflow hub statuses (DRAFT / PENDING / APPROVED / …) stay separate.
 */

export const MATRIMONY_LIFECYCLES = ["ACTIVE", "PAUSED", "CLOSED"] as const;
export type MatrimonyLifecycle = (typeof MATRIMONY_LIFECYCLES)[number];

export const LAST_SEEN_VISIBILITIES = ["EVERYONE", "MATCHES_ONLY", "NOBODY"] as const;
export type LastSeenVisibility = (typeof LAST_SEEN_VISIBILITIES)[number];

export const DEFAULT_LAST_SEEN_VISIBILITY: LastSeenVisibility = "MATCHES_ONLY";

/** Treat missing lifecycle as ACTIVE for profiles approved before this feature. */
export function normalizeMatrimonyLifecycle(
  m: { matrimonyLifecycle?: string | null; matrimonyProfileActive?: boolean | null } | null | undefined
): MatrimonyLifecycle | null {
  if (!m || m.matrimonyProfileActive !== true) return null;
  const raw = (m.matrimonyLifecycle ?? "ACTIVE").toString().toUpperCase();
  if (raw === "PAUSED" || raw === "CLOSED" || raw === "ACTIVE") return raw;
  return "ACTIVE";
}

export function isLifecycleDiscoverable(lifecycle: MatrimonyLifecycle | null): boolean {
  return lifecycle === "ACTIVE";
}
