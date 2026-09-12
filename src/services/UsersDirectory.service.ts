import { Op } from "sequelize";
import { User, MemberProfessionalIdentity, MemberExpertiseSelection, MasterDataItem } from "../models";
import { toPublicUrlIfR2 } from "../utils/r2Client";
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

  /** Community discovery (professional identity) */
  profession: string | null;
  /** One-line summary for search results. */
  expertiseSummary: string | null;
  /** Shown only when discovery identity row exists and is visible. */
  availableForHelp: boolean | null;
};

const APPROVED = "APPROVED";

/** Core columns only — incomplete live schemas must not break name/@username search. */
const SEARCH_ATTRS = [
  "id",
  "fullName",
  "username",
  "profilePhoto",
  "status",
  "city",
  "district",
  "profileVisibility",
  "occupation"
] as const;

async function toDto(
  u: User,
  relationshipStatus: RelationshipStatus = "none",
  opts?: {
    profession?: string | null;
    expertiseSummary?: string | null;
    availableForHelp?: boolean | null;
  }
): Promise<DirectoryUserDto> {
  const profileImage = u.profilePhoto ? await toPublicUrlIfR2(u.profilePhoto) : null;

  const profession = opts?.profession ?? u.occupation ?? null;
  return {
    id: u.id,
    fullName: u.fullName,
    username: u.username ?? "",
    needsUsernameSetup: !u.username,
    profileImage,
    online: await isOnline(u.id),
    city: u.city ?? null,
    district: u.district ?? null,
    profileVisibility: u.profileVisibility ?? "PUBLIC",
    relationshipStatus,

    profession,
    expertiseSummary: opts?.expertiseSummary ?? null,
    availableForHelp: typeof opts?.availableForHelp === "boolean" ? opts?.availableForHelp : null
  };
}

async function filterAndMap(meId: number, users: User[]): Promise<DirectoryUserDto[]> {
  const blocked = await getBlockedUserIds(meId).catch(() => new Set<number>());
  const visible = users.filter((u) => !blocked.has(u.id) && String(u.username ?? "").trim());
  const statusMap = await getRelationshipStatusMap(
    meId,
    visible.map((u) => u.id)
  ).catch(() => new Map<number, RelationshipStatus>());
  return Promise.all(visible.map((u) => toDto(u, statusMap.get(u.id) ?? "none")));
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

/**
 * Member directory search.
 * Name / @username matches are authoritative and are never hidden by professional
 * visibility or optional enrichment failures.
 */
export async function searchMembers(meId: number, q: string): Promise<DirectoryUserDto[]> {
  const query = q.trim();
  if (!query) return [];

  const blocked = await getBlockedUserIds(meId).catch(() => new Set<number>());
  const usernameQuery = query.startsWith("@")
    ? normalizeUsername(query.slice(1))
    : normalizeUsername(query);

  const baseWhere = {
    status: APPROVED,
    id: { [Op.ne]: meId },
    username: { [Op.ne]: null as unknown as string }
  };

  const [exactUsername, prefixUsername, nameMatches] = await Promise.all([
    usernameQuery
      ? User.findAll({
          where: { ...baseWhere, username: usernameQuery },
          attributes: [...SEARCH_ATTRS],
          limit: 10
        })
      : Promise.resolve([] as User[]),
    usernameQuery
      ? User.findAll({
          where: {
            ...baseWhere,
            username: { [Op.like]: `${usernameQuery}%` }
          },
          attributes: [...SEARCH_ATTRS],
          order: [["username", "ASC"]],
          limit: 25
        })
      : Promise.resolve([] as User[]),
    User.findAll({
      where: {
        ...baseWhere,
        fullName: { [Op.like]: `%${query}%` }
      },
      attributes: [...SEARCH_ATTRS],
      order: [["fullName", "ASC"]],
      limit: 30
    })
  ]);

  let occupationMatches: User[] = [];
  try {
    occupationMatches = await User.findAll({
      where: { ...baseWhere, occupation: { [Op.like]: `%${query}%` } },
      attributes: [...SEARCH_ATTRS],
      limit: 20
    });
  } catch {
    /* optional */
  }

  let expertiseMatches: User[] = [];
  try {
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
    if (expertiseItemIds.length > 0) {
      const selectionRows = await MemberExpertiseSelection.findAll({
        where: { expertiseItemId: { [Op.in]: expertiseItemIds } },
        attributes: ["userId"],
        limit: 400
      });
      const userIds = Array.from(new Set(selectionRows.map((r) => r.userId)));
      if (userIds.length > 0) {
        expertiseMatches = await User.findAll({
          where: { ...baseWhere, id: { [Op.in]: userIds } },
          attributes: [...SEARCH_ATTRS],
          order: [["fullName", "ASC"]],
          limit: 30
        });
      }
    }
  } catch {
    /* optional */
  }

  const merged: User[] = [];
  const seen = new Set<number>();
  for (const u of [
    ...exactUsername,
    ...prefixUsername,
    ...nameMatches,
    ...occupationMatches,
    ...expertiseMatches
  ]) {
    if (seen.has(u.id) || blocked.has(u.id)) continue;
    if (!String(u.username ?? "").trim()) continue;
    seen.add(u.id);
    merged.push(u);
  }

  if (merged.length === 0) return [];

  const ids = merged.map((u) => u.id);
  const statusMap = await getRelationshipStatusMap(meId, ids).catch(
    () => new Map<number, RelationshipStatus>()
  );

  const professionalByUserId = new Map<
    number,
    { profession: string | null; availableForHelp: boolean | null }
  >();
  const expertiseSummaryByUserId = new Map<number, string | null>();

  try {
    const professionalRows = await MemberProfessionalIdentity.findAll({
      where: { userId: { [Op.in]: ids } },
      attributes: ["userId", "profession", "availableForHelp"],
      raw: true
    });
    for (const r of professionalRows as unknown as Array<Record<string, unknown>>) {
      const userId = Number(r.userId ?? r.user_id);
      if (!Number.isFinite(userId)) continue;
      professionalByUserId.set(userId, {
        profession: (r.profession as string | null) ?? null,
        availableForHelp:
          typeof r.availableForHelp === "boolean"
            ? r.availableForHelp
            : typeof r.available_for_help === "boolean"
              ? (r.available_for_help as boolean)
              : null
      });
    }

    const selectionRows = await MemberExpertiseSelection.findAll({
      where: { userId: { [Op.in]: ids } },
      attributes: ["userId", "expertiseItemId"],
      limit: 1200
    });
    const expertiseIds = Array.from(
      new Set(
        selectionRows.map((r) =>
          Number((r as any).expertiseItemId ?? (r as any).expertise_item_id)
        )
      )
    ).filter((n) => Number.isFinite(n));

    const expertiseLabels = expertiseIds.length
      ? await MasterDataItem.findAll({
          where: { id: { [Op.in]: expertiseIds } },
          attributes: ["id", "label"],
          raw: true
        })
      : [];
    const labelById = new Map<number, string>(
      expertiseLabels.map((r: any) => [Number(r.id), String(r.label)])
    );
    const labelsByUserId = new Map<number, string[]>();
    for (const r of selectionRows as any[]) {
      const uid = Number(r.userId ?? r.user_id);
      const eid = Number(r.expertiseItemId ?? r.expertise_item_id);
      const label = labelById.get(eid);
      if (!label || !Number.isFinite(uid)) continue;
      const arr = labelsByUserId.get(uid) ?? [];
      arr.push(label);
      labelsByUserId.set(uid, arr);
    }
    for (const userId of ids) {
      const labels = labelsByUserId.get(userId) ?? [];
      const unique = Array.from(new Set(labels)).slice(0, 2);
      expertiseSummaryByUserId.set(userId, unique.length ? unique.join(", ") : null);
    }
  } catch {
    /* badges optional — never empty the result set */
  }

  return Promise.all(
    merged.map(async (u) => {
      const p = professionalByUserId.get(u.id);
      return toDto(u, statusMap.get(u.id) ?? "none", {
        profession: p?.profession ?? u.occupation ?? null,
        expertiseSummary: expertiseSummaryByUserId.get(u.id) ?? null,
        availableForHelp: p?.availableForHelp ?? null
      });
    })
  );
}

export const usersDirectoryService = { listAllExceptMe, searchMembers };
