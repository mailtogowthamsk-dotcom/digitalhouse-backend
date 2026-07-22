import { Op } from "sequelize";
import { User, MemberProfessionalIdentity, MemberExpertiseSelection, MasterDataItem } from "../models";
import { toSignedUrlIfR2 } from "../utils/r2Client";
import { isOnline } from "../realtime/presence";
import { getBlockedUserIds } from "./MatrimonySafety.service";
import { normalizeUsername } from "./Username.service";
import { getRelationshipStatusMap, type RelationshipStatus } from "./Connection.service";
import type { ProfileVisibility } from "../models/user.model";
import { masterDataService } from "./MasterData.service";

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

  /** Community discovery (professional identity) */
  profession: string | null;
  /** One-line summary for search results. */
  expertiseSummary: string | null;
  /** Shown only when discovery identity row exists and is visible. */
  availableForHelp: boolean | null;
};

const APPROVED = "APPROVED";

async function toDto(
  u: User,
  relationshipStatus: RelationshipStatus = "none",
  opts?: {
    profession?: string | null;
    expertiseSummary?: string | null;
    availableForHelp?: boolean | null;
  }
): Promise<DirectoryUserDto> {
  const profileImage =
    u.profilePhoto ? (await toSignedUrlIfR2(u.profilePhoto)) ?? u.profilePhoto : null;

  const profession = opts?.profession ?? u.occupation ?? u.jobTitle ?? null;
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
    relationshipStatus,

    profession,
    expertiseSummary: opts?.expertiseSummary ?? null,
    availableForHelp: typeof opts?.availableForHelp === "boolean" ? opts?.availableForHelp : null
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
  "profileVisibility",
  "occupation",
  "jobTitle",
  "company",
  "skills"
] as const;

async function filterAndMap(
  meId: number,
  users: User[],
  opts?: {
    professionByUserId?: Map<number, string | null>;
    expertiseSummaryByUserId?: Map<number, string | null>;
    availableByUserId?: Map<number, boolean | null>;
  }
): Promise<DirectoryUserDto[]> {
  const blocked = await getBlockedUserIds(meId);
  const visible = users.filter((u) => !blocked.has(u.id));
  const statusMap = await getRelationshipStatusMap(
    meId,
    visible.map((u) => u.id)
  );
  return Promise.all(
    visible.map((u) =>
      toDto(u, statusMap.get(u.id) ?? "none", {
        profession: opts?.professionByUserId?.get(u.id) ?? null,
        expertiseSummary: opts?.expertiseSummaryByUserId?.get(u.id) ?? null,
        availableForHelp: opts?.availableByUserId?.get(u.id) ?? null
      })
    )
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

  const usernameQuery = query.startsWith("@")
    ? normalizeUsername(query.slice(1))
    : normalizeUsername(query);

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

  // Community discovery matches (lightweight LIKE-based matching)
  const [occupationMatches, companyMatches, skillsMatches] = await Promise.all([
    User.findAll({
      where: { ...discoverableWhere, occupation: { [Op.like]: `%${query}%` } },
      attributes: [...SEARCH_ATTRS],
      limit: 20
    }),
    User.findAll({
      where: { ...discoverableWhere, company: { [Op.like]: `%${query}%` } },
      attributes: [...SEARCH_ATTRS],
      limit: 20
    }),
    User.findAll({
      where: { ...discoverableWhere, skills: { [Op.like]: `%${query}%` } },
      attributes: [...SEARCH_ATTRS],
      limit: 20
    })
  ]);

  const expertiseItems = await MasterDataItem.findAll({
    where: {
      typeCode: "EXPERTISE",
      isActive: true,
      label: { [Op.like]: `%${query}%` }
    },
    attributes: ["id"],
    limit: 15,
    order: [["label", "ASC"]]
  });

  const expertiseItemIds = expertiseItems.map((i) => i.id);
  let expertiseMatches: User[] = [];
  if (expertiseItemIds.length > 0) {
    const selectionRows = await MemberExpertiseSelection.findAll({
      where: { expertiseItemId: { [Op.in]: expertiseItemIds } },
      attributes: ["userId"],
      limit: 400
    });
    const userIds = Array.from(new Set(selectionRows.map((r) => r.userId)));
    if (userIds.length > 0) {
      expertiseMatches = await User.findAll({
        where: { ...discoverableWhere, id: { [Op.in]: userIds } },
        attributes: [...SEARCH_ATTRS],
        order: [["fullName", "ASC"]],
        limit: 30
      });
    }
  }

  const qLower = query.toLowerCase();
  const wantsAvailableOnly = /\b(available|can help|help)\b/.test(qLower);

  const merged: User[] = [];
  const seen = new Set<number>();
  for (const u of [
    ...exactUsername,
    ...prefixUsername,
    ...nameMatches,
    ...occupationMatches,
    ...companyMatches,
    ...skillsMatches,
    ...expertiseMatches
  ]) {
    if (seen.has(u.id) || blocked.has(u.id)) continue;
    seen.add(u.id);
    merged.push(u);
  }

  if (merged.length === 0) return [];

  const ids = merged.map((u) => u.id);
  const statusMap = await getRelationshipStatusMap(meId, ids);

  const professionalRows = await MemberProfessionalIdentity.findAll({
    where: { userId: { [Op.in]: ids } },
    attributes: ["userId", "profession", "availableForHelp", "visibility"],
    raw: true
  });

  const professionalByUserId = new Map<
    number,
    { profession: string | null; availableForHelp: boolean | null; visibility: "PUBLIC" | "CONNECTIONS_ONLY" | "HIDDEN" }
  >();
  for (const r of professionalRows) {
    professionalByUserId.set(r.userId, {
      profession: r.profession ?? null,
      availableForHelp: typeof r.availableForHelp === "boolean" ? r.availableForHelp : null,
      visibility: (r.visibility ?? "PUBLIC") as any
    });
  }

  const visibleIds: number[] = [];
  for (const u of merged) {
    const rel = statusMap.get(u.id) ?? "none";
    const p = professionalByUserId.get(u.id);
    const visibility = p?.visibility ?? "PUBLIC";
    if (visibility === "HIDDEN") continue;
    if (visibility === "CONNECTIONS_ONLY" && rel !== "connected") continue;
    if (wantsAvailableOnly && (p?.availableForHelp ?? false) !== true) continue;
    visibleIds.push(u.id);
  }

  if (visibleIds.length === 0) return [];

  const selectionRows = await MemberExpertiseSelection.findAll({
    where: { userId: { [Op.in]: visibleIds } },
    attributes: ["userId", "expertiseItemId"],
    limit: 1200
  });
  const expertiseIds = Array.from(
    new Set(selectionRows.map((r) => r.expertiseItemId))
  );

  const expertiseLabels = expertiseIds.length
    ? await MasterDataItem.findAll({
        where: { id: { [Op.in]: expertiseIds } },
        attributes: ["id", "label"],
        raw: true
      })
    : [];

  const labelById = new Map<number, string>(
    expertiseLabels.map((r: any) => [r.id, r.label])
  );

  const labelsByUserId = new Map<number, string[]>();
  for (const r of selectionRows as any[]) {
    const label = labelById.get(r.expertiseItemId);
    if (!label) continue;
    const arr = labelsByUserId.get(r.userId) ?? [];
    arr.push(label);
    labelsByUserId.set(r.userId, arr);
  }

  const expertiseSummaryByUserId = new Map<number, string | null>();
  for (const userId of visibleIds) {
    const labels = labelsByUserId.get(userId) ?? [];
    const unique = Array.from(new Set(labels)).slice(0, 2);
    expertiseSummaryByUserId.set(userId, unique.length ? unique.join(", ") : null);
  }

  const needsExpertiseFallback = visibleIds.some((id) => expertiseSummaryByUserId.get(id) == null);
  if (needsExpertiseFallback) {
    const allExpertise = await masterDataService.listPublicItems({ typeCode: "EXPERTISE" });
    for (const u of merged) {
      if (!visibleIds.includes(u.id)) continue;
      if (expertiseSummaryByUserId.get(u.id) != null) continue;
      const textLower = [u.skills, u.occupation, u.jobTitle].filter(Boolean).join(" ").toLowerCase();
      if (!textLower.trim()) continue;

      const matched = allExpertise
        .filter((i) => {
          const labelLower = (i.label ?? "").toLowerCase();
          const aliasHit =
            Array.isArray(i.aliases) && i.aliases.length
              ? i.aliases.some((a) => (a ?? "").toLowerCase().includes(textLower))
              : false;
          const labelHit = labelLower && textLower.includes(labelLower);
          return labelHit || aliasHit;
        })
        .map((i) => i.label)
        .filter(Boolean);

      const unique = Array.from(new Set(matched)).slice(0, 2);
      expertiseSummaryByUserId.set(u.id, unique.length ? unique.join(", ") : null);
    }
  }

  const visibleUsers = merged.filter((u) => visibleIds.includes(u.id));
  return Promise.all(
    visibleUsers.map(async (u) => {
      const p = professionalByUserId.get(u.id);
      return toDto(u, statusMap.get(u.id) ?? "none", {
        profession: p?.profession ?? null,
        expertiseSummary: expertiseSummaryByUserId.get(u.id) ?? null,
        availableForHelp: p?.availableForHelp ?? null
      });
    })
  );
}

export const usersDirectoryService = { listAllExceptMe, searchMembers };
