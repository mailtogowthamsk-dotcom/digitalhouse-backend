import { Op } from "sequelize";
import { User, UsernameReservation } from "../models";

const USERNAME_REGEX = /^[a-z][a-z0-9_]{2,29}$/;
const RESERVED_USERNAMES = new Set([
  "admin",
  "support",
  "help",
  "digitalhouse",
  "digital_house",
  "moderator",
  "system",
  "official",
  "null",
  "undefined"
]);
const MAX_CHANGES_PER_YEAR = 2;
const CHANGE_COOLDOWN_DAYS = 30;
const RESERVATION_DAYS = 90;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsernameFormat(username: string): void {
  if (!USERNAME_REGEX.test(username)) {
    throw Object.assign(
      new Error(
        "Username must be 3–30 characters, start with a letter, and use only lowercase letters, numbers, or underscores."
      ),
      { status: 400, code: "INVALID_USERNAME" }
    );
  }
  if (RESERVED_USERNAMES.has(username)) {
    throw Object.assign(new Error("This username is not available."), {
      status: 400,
      code: "USERNAME_RESERVED"
    });
  }
}

async function isReservedByOther(username: string, forUserId?: number): Promise<boolean> {
  const now = new Date();
  const row = await UsernameReservation.findOne({
    where: {
      username,
      reservedUntil: { [Op.gt]: now }
    }
  });
  if (!row) return false;
  if (forUserId && row.reservedForUserId === forUserId) return false;
  return true;
}

export async function isUsernameAvailable(username: string, forUserId?: number): Promise<boolean> {
  const normalized = normalizeUsername(username);
  validateUsernameFormat(normalized);

  const taken = await User.findOne({
    where: { username: normalized },
    attributes: ["id"]
  });
  if (taken && taken.id !== forUserId) return false;

  if (await isReservedByOther(normalized, forUserId)) return false;
  return true;
}

async function countRecentUsernameChanges(userId: number): Promise<number> {
  const since = new Date();
  since.setFullYear(since.getFullYear() - 1);
  return UsernameReservation.count({
    where: {
      reservedForUserId: userId,
      createdAt: { [Op.gte]: since }
    }
  });
}

export async function getUsernameChangeEligibility(userId: number): Promise<{
  canChange: boolean;
  reason?: string;
  changesUsed: number;
  changesLimit: number;
  nextEligibleAt?: string;
}> {
  const user = await User.findByPk(userId, { attributes: ["id", "username", "usernameChangedAt"] });
  if (!user?.username) {
    return { canChange: true, changesUsed: 0, changesLimit: MAX_CHANGES_PER_YEAR };
  }

  const changesUsed = await countRecentUsernameChanges(userId);
  if (changesUsed >= MAX_CHANGES_PER_YEAR) {
    return {
      canChange: false,
      reason: "You have reached the username change limit for this year.",
      changesUsed,
      changesLimit: MAX_CHANGES_PER_YEAR
    };
  }

  if (user.usernameChangedAt) {
    const next = new Date(user.usernameChangedAt);
    next.setDate(next.getDate() + CHANGE_COOLDOWN_DAYS);
    if (next > new Date()) {
      return {
        canChange: false,
        reason: `You can change your username again after ${next.toLocaleDateString()}.`,
        changesUsed,
        changesLimit: MAX_CHANGES_PER_YEAR,
        nextEligibleAt: next.toISOString()
      };
    }
  }

  return { canChange: true, changesUsed, changesLimit: MAX_CHANGES_PER_YEAR };
}

async function reserveUsername(oldUsername: string, userId: number): Promise<void> {
  const reservedUntil = new Date();
  reservedUntil.setDate(reservedUntil.getDate() + RESERVATION_DAYS);
  await UsernameReservation.upsert({
    username: oldUsername,
    reservedForUserId: userId,
    reservedUntil,
    createdAt: new Date()
  } as any);
}

export async function assignUsername(userId: number, rawUsername: string): Promise<User> {
  const user = await User.findByPk(userId);
  if (!user) throw Object.assign(new Error("User not found."), { status: 404 });
  if (user.username) {
    throw Object.assign(new Error("Username is already set. Use change username instead."), {
      status: 409,
      code: "USERNAME_ALREADY_SET"
    });
  }

  const username = normalizeUsername(rawUsername);
  validateUsernameFormat(username);
  if (!(await isUsernameAvailable(username, userId))) {
    throw Object.assign(new Error("This username is already taken."), {
      status: 409,
      code: "USERNAME_TAKEN"
    });
  }

  await user.update({ username, usernameChangedAt: new Date() } as any);
  return user;
}

export async function changeUsername(userId: number, rawUsername: string): Promise<User> {
  const user = await User.findByPk(userId);
  if (!user) throw Object.assign(new Error("User not found."), { status: 404 });
  if (!user.username) {
    return assignUsername(userId, rawUsername);
  }

  const eligibility = await getUsernameChangeEligibility(userId);
  if (!eligibility.canChange) {
    throw Object.assign(new Error(eligibility.reason ?? "Username cannot be changed right now."), {
      status: 403,
      code: "USERNAME_CHANGE_BLOCKED"
    });
  }

  const nextUsername = normalizeUsername(rawUsername);
  validateUsernameFormat(nextUsername);
  if (nextUsername === user.username) {
    throw Object.assign(new Error("This is already your username."), { status: 400 });
  }
  if (!(await isUsernameAvailable(nextUsername, userId))) {
    throw Object.assign(new Error("This username is already taken."), {
      status: 409,
      code: "USERNAME_TAKEN"
    });
  }

  const oldUsername = user.username;
  await user.update({ username: nextUsername, usernameChangedAt: new Date() } as any);
  await reserveUsername(oldUsername, userId);
  return user;
}

export const usernameService = {
  normalizeUsername,
  validateUsernameFormat,
  isUsernameAvailable,
  getUsernameChangeEligibility,
  assignUsername,
  changeUsername
};
