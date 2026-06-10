import { Op } from "sequelize";
import { MessageThreadPreference } from "../models";

export type ThreadPreferenceDto = {
  otherUserId: number;
  muted: boolean;
  archived: boolean;
  leftAt: string | null;
};

async function getOrCreate(userId: number, otherUserId: number): Promise<MessageThreadPreference> {
  const [row] = await MessageThreadPreference.findOrCreate({
    where: { userId, otherUserId },
    defaults: { userId, otherUserId, muted: false, archived: false, leftAt: null } as any
  });
  return row;
}

function toDto(row: MessageThreadPreference): ThreadPreferenceDto {
  return {
    otherUserId: row.otherUserId,
    muted: row.muted,
    archived: row.archived,
    leftAt: row.leftAt ? row.leftAt.toISOString() : null
  };
}

export async function getThreadPreference(
  userId: number,
  otherUserId: number
): Promise<ThreadPreferenceDto | null> {
  const row = await MessageThreadPreference.findOne({ where: { userId, otherUserId } });
  return row ? toDto(row) : null;
}

export async function isThreadMuted(userId: number, otherUserId: number): Promise<boolean> {
  const row = await MessageThreadPreference.findOne({
    where: { userId, otherUserId, muted: true },
    attributes: ["id"]
  });
  return row != null;
}

export async function getLeftThreadUserIds(userId: number): Promise<Set<number>> {
  const rows = await MessageThreadPreference.findAll({
    where: { userId, leftAt: { [Op.ne]: null } },
    attributes: ["otherUserId"]
  });
  return new Set(rows.map((r) => r.otherUserId));
}

export async function getArchivedThreadUserIds(userId: number): Promise<Set<number>> {
  const rows = await MessageThreadPreference.findAll({
    where: { userId, archived: true },
    attributes: ["otherUserId"]
  });
  return new Set(rows.map((r) => r.otherUserId));
}

export async function getThreadPreferencesMap(
  userId: number,
  otherUserIds: number[]
): Promise<Map<number, { muted: boolean; archived: boolean }>> {
  if (otherUserIds.length === 0) return new Map();
  const rows = await MessageThreadPreference.findAll({
    where: { userId, otherUserId: { [Op.in]: otherUserIds } },
    attributes: ["otherUserId", "muted", "archived"]
  });
  return new Map(
    rows.map((r) => [r.otherUserId, { muted: r.muted, archived: r.archived }])
  );
}

export async function updateThreadPreference(
  userId: number,
  otherUserId: number,
  patch: { muted?: boolean; archived?: boolean; left?: boolean }
): Promise<ThreadPreferenceDto> {
  const row = await getOrCreate(userId, otherUserId);
  const updates: Record<string, unknown> = {};
  if (patch.muted !== undefined) updates.muted = patch.muted;
  if (patch.archived !== undefined) updates.archived = patch.archived;
  if (patch.left === true) {
    updates.leftAt = new Date();
    updates.archived = true;
  }
  if (patch.left === false) {
    updates.leftAt = null;
  }
  await row.update(updates as any);
  return toDto(row);
}

export const threadPreferenceService = {
  getThreadPreference,
  isThreadMuted,
  getLeftThreadUserIds,
  getArchivedThreadUserIds,
  getThreadPreferencesMap,
  updateThreadPreference
};
