/**
 * Last-seen / online reveal with privacy.
 * Reuses in-memory presence + durable users.last_seen_at.
 * Default visibility: MATCHES_ONLY.
 */

import { User } from "../models";
import type { LastSeenVisibility } from "../models/user.model";
import {
  DEFAULT_LAST_SEEN_VISIBILITY,
  LAST_SEEN_VISIBILITIES,
  type LastSeenVisibility as LifecycleLastSeenVisibility
} from "../constants/matrimony-lifecycle.constants";
import { getLastSeenAt, isOnline } from "../realtime/presence";

const LAST_SEEN_WRITE_THROTTLE_MS = 90_000;
const lastPersistAt = new Map<number, number>();

export type PresenceReveal = {
  online: boolean;
  lastSeenAt: string | null;
  /** When privacy hides the value */
  hidden: boolean;
  label: "Online" | "Last Seen Hidden" | string;
};

function normalizeVisibility(raw: string | null | undefined): LastSeenVisibility {
  const v = (raw ?? DEFAULT_LAST_SEEN_VISIBILITY).toUpperCase();
  if ((LAST_SEEN_VISIBILITIES as readonly string[]).includes(v)) {
    return v as LastSeenVisibility;
  }
  return DEFAULT_LAST_SEEN_VISIBILITY;
}

/** Persist last-seen on becameOffline — throttled to avoid write storms. */
export async function persistLastSeenAt(userId: number, at: Date = new Date()): Promise<void> {
  const now = Date.now();
  const prev = lastPersistAt.get(userId) ?? 0;
  if (now - prev < LAST_SEEN_WRITE_THROTTLE_MS) return;
  lastPersistAt.set(userId, now);
  try {
    await User.update({ lastSeenAt: at } as any, { where: { id: userId } });
  } catch {
    /* non-fatal */
  }
}

export async function getLastSeenVisibility(userId: number): Promise<LastSeenVisibility> {
  const user = await User.findByPk(userId, { attributes: ["lastSeenVisibility"] });
  return normalizeVisibility(user?.lastSeenVisibility);
}

export async function setLastSeenVisibility(
  userId: number,
  visibility: LifecycleLastSeenVisibility
): Promise<LastSeenVisibility> {
  if (!(LAST_SEEN_VISIBILITIES as readonly string[]).includes(visibility)) {
    throw Object.assign(new Error("Invalid last-seen visibility"), { status: 400 });
  }
  await User.update({ lastSeenVisibility: visibility } as any, { where: { id: userId } });
  return visibility;
}

function formatLastSeenLabel(iso: string | null, online: boolean, hidden: boolean): string {
  if (hidden) return "Last Seen Hidden";
  if (online) return "Online";
  if (!iso) return "Last Seen Hidden";
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "Last Seen Hidden";
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "Last Seen Just Now";
  if (mins < 60) return `Last Seen ${mins} Minute${mins === 1 ? "" : "s"} Ago`;
  const hours = Math.floor(mins / 60);
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const yesterday = new Date(dayStart);
  yesterday.setDate(yesterday.getDate() - 1);
  const seenDay = new Date(ts);
  seenDay.setHours(0, 0, 0, 0);
  if (seenDay.getTime() === dayStart.getTime()) {
    return `Last Seen Today`;
  }
  if (seenDay.getTime() === yesterday.getTime()) {
    return "Last Seen Yesterday";
  }
  if (hours < 48) return `Last Seen ${hours} Hour${hours === 1 ? "" : "s"} Ago`;
  return `Last Seen ${seenDay.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: seenDay.getFullYear() !== dayStart.getFullYear() ? "numeric" : undefined
  })}`;
}

/**
 * Resolve online / last-seen for a viewer looking at a subject.
 * Admin bypass: pass { adminBypass: true }.
 */
export async function revealPresence(
  viewerId: number | null,
  subjectId: number,
  opts?: { adminBypass?: boolean }
): Promise<PresenceReveal> {
  const online = isOnline(subjectId);
  const memorySeen = getLastSeenAt(subjectId);
  let durableSeen: string | null = null;
  let visibility: LastSeenVisibility = DEFAULT_LAST_SEEN_VISIBILITY;

  const subject = await User.findByPk(subjectId, {
    attributes: ["id", "lastSeenAt", "lastSeenVisibility"]
  });
  if (subject?.lastSeenAt) {
    durableSeen = subject.lastSeenAt.toISOString();
  }
  visibility = normalizeVisibility(subject?.lastSeenVisibility);

  const lastSeenAt =
    online
      ? null
      : memorySeen ??
        durableSeen ??
        null;

  if (opts?.adminBypass) {
    return {
      online,
      lastSeenAt,
      hidden: false,
      label: formatLastSeenLabel(lastSeenAt, online, false)
    };
  }

  if (viewerId == null) {
    return { online: false, lastSeenAt: null, hidden: true, label: "Last Seen Hidden" };
  }
  if (viewerId === subjectId) {
    return {
      online,
      lastSeenAt,
      hidden: false,
      label: formatLastSeenLabel(lastSeenAt, online, false)
    };
  }

  if (visibility === "NOBODY") {
    return { online: false, lastSeenAt: null, hidden: true, label: "Last Seen Hidden" };
  }

  if (visibility === "MATCHES_ONLY") {
    const { getActiveMatrimonyMatch } = await import("./MatrimonyDiscover.service");
    const match = await getActiveMatrimonyMatch(viewerId, subjectId);
    if (!match) {
      return { online: false, lastSeenAt: null, hidden: true, label: "Last Seen Hidden" };
    }
  }

  return {
    online,
    lastSeenAt,
    hidden: false,
    label: formatLastSeenLabel(lastSeenAt, online, false)
  };
}

export async function revealPresenceBatch(
  viewerId: number,
  subjectIds: number[]
): Promise<Record<string, PresenceReveal>> {
  const unique = [...new Set(subjectIds.filter((n) => Number.isFinite(n) && n > 0))];
  const out: Record<string, PresenceReveal> = {};
  await Promise.all(
    unique.map(async (id) => {
      out[String(id)] = await revealPresence(viewerId, id);
    })
  );
  return out;
}
