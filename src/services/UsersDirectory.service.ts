import { Op } from "sequelize";
import { User } from "../models";
import { toSignedUrlIfR2 } from "../utils/r2Client";
import { isOnline } from "../realtime/presence";
import { getBlockedUserIds } from "./MatrimonySafety.service";
import { normalizeUsername } from "./Username.service";
import { getRelationshipStatusMap, type RelationshipStatus } from "./Connection.service";
import type { ProfileVisibility } from "../models/user.model";

export type DirectoryUserDto = {
  id: number;
  fullName: string;
  username: string;
  needsUsernameSetup: boolean;
  profileImage: string | null;
  online: boolean;
  city: string | null;
  district: string | null;
  profileVisibility: ProfileVisibility;
  relationshipStatus: RelationshipStatus;
};

const APPROVED = "APPROVED";

async function toDto(
  u: User,
  relationshipStatus: RelationshipStatus = "none"
): Promise<DirectoryUserDto> {
  const profileImage =
    u.profilePhoto ? (await toSignedUrlIfR2(u.profilePhoto)) ?? u.profilePhoto : null;
  return {
    id: u.id,
    fullName: u.fullName,
    username: u.username ?? "",
    needsUsernameSetup: !u.username,
    profileImage,
    online: isOnline(u.id),
    city: u.city ?? null,
    district: u.district ?? null,
    profileVisibility: u.profileVisibility ?? "PUBLIC",
    relationshipStatus
  };
}

const SEARCH_ATTRS = [
  "id",
  "fullName",
  "username",
  "profilePhoto",
  "status",
  "city",
  "district",
  "profileVisibility"
] as const;

async function filterAndMap(meId: number, users: User[]): Promise<DirectoryUserDto[]> {
  const blocked = await getBlockedUserIds(meId);
  const visible = users.filter((u) => !blocked.has(u.id));
  const statusMap = await getRelationshipStatusMap(
    meId,
    visible.map((u) => u.id)
  );
  return Promise.all(
    visible.map((u) => toDto(u, statusMap.get(u.id) ?? "none"))
  );
}

export async function listAllExceptMe(meId: number): Promise<DirectoryUserDto[]> {
  const users = await User.findAll({
    where: {
      status: APPROVED,
      id: { [Op.ne]: meId },
      username: { [Op.ne]: null }
    },
    attributes: [...SEARCH_ATTRS],
    order: [["fullName", "ASC"]],
    limit: 100
  });
  return filterAndMap(meId, users);
}

export async function searchMembers(meId: number, q: string): Promise<DirectoryUserDto[]> {
  const query = q.trim();
  if (!query) return [];

  const blocked = await getBlockedUserIds(meId);
  const approvedNotSelf = {
    status: APPROVED,
    id: { [Op.ne]: meId }
  };
  const discoverableWhere = {
    ...approvedNotSelf,
    username: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: "" }] }
  };

  const usernameQuery = query.startsWith("@") ? normalizeUsername(query.slice(1)) : normalizeUsername(query);

  const exactUsername = await User.findAll({
    where: { ...discoverableWhere, username: usernameQuery },
    attributes: [...SEARCH_ATTRS],
    limit: 10
  });

  const prefixUsername = await User.findAll({
    where: {
      ...discoverableWhere,
      username: { [Op.like]: `${usernameQuery}%` },
      id: { [Op.notIn]: exactUsername.map((u) => u.id).concat(meId) }
    },
    attributes: [...SEARCH_ATTRS],
    order: [["username", "ASC"]],
    limit: 20
  });

  const nameMatches = await User.findAll({
    where: {
      ...approvedNotSelf,
      fullName: { [Op.like]: `%${query}%` },
      id: {
        [Op.notIn]: [...exactUsername, ...prefixUsername].map((u) => u.id).concat(meId)
      }
    },
    attributes: [...SEARCH_ATTRS],
    order: [["fullName", "ASC"]],
    limit: 30
  });

  const merged: User[] = [];
  const seen = new Set<number>();
  for (const u of [...exactUsername, ...prefixUsername, ...nameMatches]) {
    if (seen.has(u.id) || blocked.has(u.id)) continue;
    seen.add(u.id);
    merged.push(u);
  }

  const statusMap = await getRelationshipStatusMap(
    meId,
    merged.map((u) => u.id)
  );
  return Promise.all(
    merged.map((u) => toDto(u, statusMap.get(u.id) ?? "none"))
  );
}

export const usersDirectoryService = { listAllExceptMe, searchMembers };
