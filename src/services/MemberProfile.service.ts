import { Op } from "sequelize";
import { User } from "../models";
import { toSignedUrlIfR2 } from "../utils/r2Client";
import { getBlockedUserIds } from "./MatrimonySafety.service";
import {
  getRelationshipStatus,
  type RelationshipStatus
} from "./Connection.service";
import { MatrimonyBlock } from "../models";
import type { ProfileVisibility } from "../models/user.model";

export type MemberProfileDto = {
  id: number;
  fullName: string;
  username: string;
  profileImage: string | null;
  city: string | null;
  district: string | null;
  community: string | null;
  occupation: string | null;
  communityRole: string | null;
  memberSince: string;
  profileVisibility: ProfileVisibility;
  isPrivatePreview: boolean;
  isSelf: boolean;
  needsUsernameSetup: boolean;
  relationshipStatus: RelationshipStatus;
  acceptsConnectionRequests?: boolean;
};

export type MemberProfileLimitedDto = {
  id: number;
  fullName: string;
  username: string;
  profileImage: string | null;
  city: string | null;
  district: string | null;
  profileVisibility: ProfileVisibility;
  isPrivatePreview: true;
  needsUsernameSetup: boolean;
  relationshipStatus: RelationshipStatus;
  acceptsConnectionRequests?: boolean;
};

async function resolveTarget(identifier: string): Promise<User | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    return User.findByPk(Number(trimmed), {
      attributes: [
        "id",
        "fullName",
        "username",
        "profilePhoto",
        "city",
        "district",
        "community",
        "occupation",
        "communityRole",
        "profileVisibility",
        "allowConnectionRequests",
        "status",
        "createdAt"
      ]
    });
  }

  const username = trimmed.startsWith("@") ? trimmed.slice(1).toLowerCase() : trimmed.toLowerCase();
  return User.findOne({
    where: { username },
    attributes: [
      "id",
      "fullName",
      "username",
      "profilePhoto",
      "city",
      "district",
      "community",
      "occupation",
      "communityRole",
      "profileVisibility",
      "allowConnectionRequests",
      "status",
      "createdAt"
    ]
  });
}

function toLimited(u: User): MemberProfileLimitedDto {
  return {
    id: u.id,
    fullName: u.fullName,
    username: u.username ?? "",
    profileImage: null,
    city: u.city ?? null,
    district: u.district ?? null,
    profileVisibility: u.profileVisibility ?? "PRIVATE",
    isPrivatePreview: true,
    needsUsernameSetup: !u.username,
    relationshipStatus: "none"
  };
}

export async function getMemberProfile(
  viewerId: number,
  identifier: string
): Promise<MemberProfileDto | MemberProfileLimitedDto> {
  const target = await resolveTarget(identifier);
  if (!target || target.status !== "APPROVED") {
    throw Object.assign(new Error("Member not found."), { status: 404, code: "MEMBER_NOT_FOUND" });
  }

  const isUsernameLookup = !/^\d+$/.test(identifier.trim());
  if (isUsernameLookup && !target.username) {
    throw Object.assign(new Error("Member not found."), { status: 404, code: "MEMBER_NOT_FOUND" });
  }

  const blocked = await getBlockedUserIds(viewerId);
  if (blocked.has(target.id)) {
    throw Object.assign(new Error("This profile is not available."), {
      status: 403,
      code: "PROFILE_BLOCKED"
    });
  }

  const profileImage = target.profilePhoto
    ? (await toSignedUrlIfR2(target.profilePhoto)) ?? target.profilePhoto
    : null;

  const isSelf = viewerId === target.id;
  const needsUsernameSetup = !target.username;
  const isPrivate = target.profileVisibility === "PRIVATE";
  const relationshipStatus = isSelf || needsUsernameSetup
    ? ("none" as RelationshipStatus)
    : await getRelationshipStatus(viewerId, target.id);
  const isConnected = relationshipStatus === "connected";

  if (needsUsernameSetup && !isSelf) {
    return {
      ...toLimited(target),
      profileImage,
      relationshipStatus: "none",
      acceptsConnectionRequests: target.allowConnectionRequests !== false
    };
  }

  if (isPrivate && !isSelf && !isConnected) {
    return {
      ...toLimited(target),
      profileImage,
      relationshipStatus,
      acceptsConnectionRequests: target.allowConnectionRequests !== false
    };
  }

  return {
    id: target.id,
    fullName: target.fullName,
    username: target.username ?? "",
    profileImage,
    city: target.city ?? null,
    district: target.district ?? null,
    community: target.community ?? null,
    occupation: target.occupation ?? null,
    communityRole: target.communityRole ?? null,
    memberSince: target.createdAt.toISOString(),
    profileVisibility: target.profileVisibility ?? "PUBLIC",
    isPrivatePreview: false,
    isSelf,
    needsUsernameSetup,
    relationshipStatus,
    acceptsConnectionRequests: target.allowConnectionRequests !== false
  };
}

export async function updateAllowConnectionRequests(
  userId: number,
  allow: boolean
): Promise<{ allowConnectionRequests: boolean }> {
  const user = await User.findByPk(userId);
  if (!user) throw Object.assign(new Error("User not found."), { status: 404 });
  await user.update({ allowConnectionRequests: allow } as any);
  return { allowConnectionRequests: allow };
}

export async function listBlockedMembers(viewerId: number): Promise<
  Array<{ id: number; fullName: string; username: string | null }>
> {
  const rows = await MatrimonyBlock.findAll({
    where: { userId: viewerId },
    attributes: ["blockedUserId"],
    order: [["createdAt", "DESC"]],
    limit: 200
  });
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.blockedUserId);
  const users = await User.findAll({
    where: { id: { [Op.in]: ids } },
    attributes: ["id", "fullName", "username"]
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows
    .map((r) => {
      const u = byId.get(r.blockedUserId);
      if (!u) return null;
      return { id: u.id, fullName: u.fullName, username: u.username };
    })
    .filter((x): x is { id: number; fullName: string; username: string | null } => x != null);
}

export async function updateProfileVisibility(
  userId: number,
  visibility: ProfileVisibility
): Promise<{ profileVisibility: ProfileVisibility }> {
  const user = await User.findByPk(userId);
  if (!user) throw Object.assign(new Error("User not found."), { status: 404 });
  await user.update({ profileVisibility: visibility } as any);
  return { profileVisibility: visibility };
}

export const memberProfileService = {
  getMemberProfile,
  updateProfileVisibility,
  updateAllowConnectionRequests,
  listBlockedMembers
};
