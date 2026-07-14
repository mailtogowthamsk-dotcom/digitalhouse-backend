import { UserProfile } from "../models";

const EMPTY_SECTIONS = {
  community: {},
  personal: {},
  matrimony: {},
  business: {},
  family: {}
} as const;

function isUniqueUserIdConflict(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    name?: string;
    parent?: { code?: string };
    original?: { code?: string };
  };
  if (e.name === "SequelizeUniqueConstraintError") return true;
  const code = e.parent?.code || e.original?.code;
  return code === "ER_DUP_ENTRY";
}

/**
 * Lazily create a UserProfile row for a user.
 * Safe under concurrent GET /profile/me (mobile often fires the route twice).
 */
export async function ensureUserProfile(userId: number): Promise<UserProfile> {
  const existing = await UserProfile.findOne({ where: { userId } });
  if (existing) return existing;

  try {
    return await UserProfile.create({
      userId,
      ...EMPTY_SECTIONS
    } as any);
  } catch (err) {
    if (isUniqueUserIdConflict(err)) {
      const again = await UserProfile.findOne({ where: { userId } });
      if (again) return again;
    }
    throw err;
  }
}
