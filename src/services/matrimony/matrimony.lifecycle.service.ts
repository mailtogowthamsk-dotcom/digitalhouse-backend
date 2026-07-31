import { UserProfile } from "../../models";
import type { MatrimonySection } from "../../models/UserProfile.model";
import { writeAudit } from "../MatrimonyAudit.service";
import { normalizeJsonColumn, SECTION_ALLOWED_KEYS } from "../Profile.service";
import {
  normalizeMatrimonyLifecycle,
  type MatrimonyLifecycle
} from "../../constants/matrimony-lifecycle.constants";
import type { MatrimonyHubResponse } from "./matrimony.types";
import { getMatrimonyHub } from "./matrimony.hub.service";

/**
 * Soft pause: hide from discovery / new interests; keep matches + chats.
 * Does NOT call closeAllMatrimonyWorkflowForUser.
 */
export async function pauseMatrimonyProfile(userId: number): Promise<MatrimonyHubResponse> {
  return transitionMatrimonyLifecycle(userId, "PAUSED");
}

/** Resume a paused profile back to ACTIVE (discoverable). */
export async function resumeMatrimonyProfile(userId: number): Promise<MatrimonyHubResponse> {
  return transitionMatrimonyLifecycle(userId, "ACTIVE", { from: ["PAUSED"] });
}

/**
 * Soft close: hide from discovery / new interests; preserve matches, chats,
 * subscriptions, and audit history. Does NOT delete the profile.
 */
export async function closeMatrimonyProfile(
  userId: number,
  reason?: string | null
): Promise<MatrimonyHubResponse> {
  return transitionMatrimonyLifecycle(userId, "CLOSED", {
    from: ["ACTIVE", "PAUSED"],
    closeReason: reason?.trim() || null
  });
}

/** Reactivate a closed profile (back to ACTIVE / discoverable). */
export async function reactivateMatrimonyProfile(userId: number): Promise<MatrimonyHubResponse> {
  return transitionMatrimonyLifecycle(userId, "ACTIVE", { from: ["CLOSED"] });
}

/**
 * @deprecated Prefer closeMatrimonyProfile. Kept for API compatibility —
 * now performs a soft close (matches/chats preserved), not a hard workflow wipe.
 */
export async function withdrawMatrimonyProfile(userId: number): Promise<MatrimonyHubResponse> {
  return closeMatrimonyProfile(userId, "withdrawn");
}

async function transitionMatrimonyLifecycle(
  userId: number,
  next: MatrimonyLifecycle,
  opts?: { from?: MatrimonyLifecycle[]; closeReason?: string | null }
): Promise<MatrimonyHubResponse> {
  const profile = await UserProfile.findOne({ where: { userId } });
  if (!profile) throw Object.assign(new Error("Profile not found"), { status: 404 });
  const m = normalizeJsonColumn(profile.matrimony, SECTION_ALLOWED_KEYS.matrimony) as MatrimonySection | null;
  if (!m?.matrimonyProfileActive) {
    throw Object.assign(new Error("No approved matrimony profile for this action"), { status: 400 });
  }
  if (m.matrimonySuspended === true) {
    throw Object.assign(new Error("Your matrimony profile is suspended by admin"), { status: 403 });
  }

  const current = normalizeMatrimonyLifecycle(m) ?? "ACTIVE";
  if (opts?.from && !opts.from.includes(current)) {
    throw Object.assign(
      new Error(`Cannot move profile from ${current} to ${next}`),
      { status: 400 }
    );
  }
  if (current === next) {
    return getMatrimonyHub(userId);
  }

  const now = new Date().toISOString();
  const patched: MatrimonySection = {
    ...m,
    matrimonyProfileActive: true,
    matrimonyLifecycle: next,
    pausedAt: next === "PAUSED" ? now : null,
    closedAt: next === "CLOSED" ? now : null,
    withdrawnAt: next === "CLOSED" ? now : m.withdrawnAt ?? null,
    closeReason: next === "CLOSED" ? opts?.closeReason ?? null : null
  };

  await profile.update({ matrimony: patched as any, updatedAt: new Date() } as any);

  const auditAction =
    next === "PAUSED"
      ? "PROFILE_PAUSED"
      : next === "CLOSED"
        ? "PROFILE_CLOSED"
        : current === "CLOSED"
          ? "PROFILE_REACTIVATED"
          : "PROFILE_RESUMED";

  await writeAudit(userId, null, auditAction, "user", {
    from: current,
    to: next,
    at: now,
    closeReason: opts?.closeReason ?? null
  }).catch(() => {});

  return getMatrimonyHub(userId);
}
