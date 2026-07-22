import { Op } from "sequelize";
import {
  User,
  Post,
  PostLike,
  Comment,
  SavedPost,
  MemberConnection,
  MemberProfessionalIdentity,
  MemberExpertiseSelection,
  MasterDataItem
} from "../models";
import { toSignedUrlIfR2 } from "../utils/r2Client";
import { getBlockedUserIds } from "./MatrimonySafety.service";
import {
  getRelationshipStatus,
  type RelationshipStatus
} from "./Connection.service";
import { MatrimonyBlock } from "../models";
import type { ProfileVisibility } from "../models/user.model";
import { resolvePostMediaType, type PostMediaType } from "../constants/postMedia.constants";
import { audienceVisibilityWhere, andWhere } from "./PostVisibility.service";
import { masterDataService } from "./MasterData.service";

export type MemberProfileStats = {
  postsCount: number;
  connectionsCount: number;
  likesReceivedCount: number;
};

export type MemberProfileDto = {
  id: number;
  fullName: string;
  username: string;
  profileImage: string | null;
  city: string | null;
  district: string | null;
  community: string | null;
  kulam: string | null;
  occupation: string | null;
  communityRole: string | null;

  /** Community discovery: professional identity */
  profession: string | null;
  company: string | null;
  experience: string | null;
  expertiseTags: string[];
  availableForHelp: boolean | null;
  memberSince: string;
  profileVisibility: ProfileVisibility;
  isPrivatePreview: boolean;
  isSelf: boolean;
  needsUsernameSetup: boolean;
  relationshipStatus: RelationshipStatus;
  acceptsConnectionRequests?: boolean;
  /** Present when viewer can see full profile. */
  stats?: MemberProfileStats;
  /** ISO date when ACCEPTED connection was established (if connected). */
  connectedSince?: string | null;
  /** Whether viewer may list this member's posts. */
  canViewPosts: boolean;
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
  canViewPosts: false;
  stats?: MemberProfileStats;
};

export type MemberPostItemDto = {
  postId: number;
  postType: string;
  title: string;
  description: string | null;
  mediaUrl: string | null;
  mediaType: PostMediaType;
  thumbnailUrl: string | null;
  videoDuration: number | null;
  createdAt: string;
  counts: { likes: number; comments: number };
  likedByMe: boolean;
  savedByMe: boolean;
  isRepost?: boolean;
  originalPostId?: number | null;
  originalAuthorName?: string | null;
};

export type MemberPostsResultDto = {
  items: MemberPostItemDto[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  canViewPosts: boolean;
  /** Connections-only posts hidden from this viewer (non-connection). */
  connectionsOnlyHiddenCount?: number;
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
        "kulam",
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
      "kulam",
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
    relationshipStatus: "none",
    canViewPosts: false
  };
}

async function getMemberStats(userId: number): Promise<MemberProfileStats> {
  const [postsCount, connectionsCount, likesReceivedCount] = await Promise.all([
    Post.count({
      where: {
        userId,
        [Op.or]: [
          { postType: { [Op.ne]: "MARKETPLACE" } },
          { marketplaceStatus: "LIVE" },
          { marketplaceStatus: null }
        ]
      }
    }),
    MemberConnection.count({
      where: {
        status: "ACCEPTED",
        [Op.or]: [{ requesterUserId: userId }, { recipientUserId: userId }]
      }
    }),
    PostLike.count({
      include: [
        {
          association: "Post",
          attributes: [],
          required: true,
          where: { userId }
        }
      ]
    })
  ]);
  return { postsCount, connectionsCount, likesReceivedCount };
}

async function getConnectedSince(viewerId: number, targetId: number): Promise<string | null> {
  const row = await MemberConnection.findOne({
    where: {
      status: "ACCEPTED",
      [Op.or]: [
        { requesterUserId: viewerId, recipientUserId: targetId },
        { requesterUserId: targetId, recipientUserId: viewerId }
      ]
    },
    attributes: ["respondedAt", "createdAt"],
    order: [["respondedAt", "DESC"]]
  });
  if (!row) return null;
  return (row.respondedAt ?? row.createdAt).toISOString();
}

function canViewerSeePosts(opts: {
  isSelf: boolean;
  isPrivate: boolean;
  isConnected: boolean;
  needsUsernameSetup: boolean;
}): boolean {
  if (opts.needsUsernameSetup && !opts.isSelf) return false;
  if (opts.isSelf) return true;
  if (!opts.isPrivate) return true;
  return opts.isConnected;
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
      acceptsConnectionRequests: target.allowConnectionRequests !== false,
      canViewPosts: false
    };
  }

  if (isPrivate && !isSelf && !isConnected) {
    const stats = await getMemberStats(target.id);
    return {
      ...toLimited(target),
      profileImage,
      relationshipStatus,
      acceptsConnectionRequests: target.allowConnectionRequests !== false,
      canViewPosts: false,
      // Public-safe aggregates only (counts, not post content)
      stats: {
        postsCount: 0,
        connectionsCount: stats.connectionsCount,
        likesReceivedCount: 0
      }
    };
  }

  const [stats, connectedSince] = await Promise.all([
    getMemberStats(target.id),
    isConnected ? getConnectedSince(viewerId, target.id) : Promise.resolve(null)
  ]);

  const identityRow = await MemberProfessionalIdentity.findOne({
    where: { userId: target.id },
    attributes: ["profession", "company", "experience", "availableForHelp", "visibility"],
    raw: true
  });

  const identityVisibility = identityRow?.visibility ?? "PUBLIC";
  const canViewProfessionalIdentity =
    isSelf || identityVisibility === "PUBLIC" || (identityVisibility === "CONNECTIONS_ONLY" && isConnected);

  let expertiseTags: string[] = [];
  if (canViewProfessionalIdentity) {
    const selections = await MemberExpertiseSelection.findAll({
      where: { userId: target.id },
      attributes: ["expertiseItemId"],
      raw: true,
      limit: 50
    });
    const expertiseItemIds = Array.from(new Set(selections.map((s) => s.expertiseItemId)));
    if (expertiseItemIds.length) {
      const items = await MasterDataItem.findAll({
        where: { id: { [Op.in]: expertiseItemIds } },
        attributes: ["id", "label"],
        raw: true
      });
      const labels = items.map((i) => i.label).filter(Boolean);
      // stable ordering: label ASC (keeps UI calm)
      expertiseTags = Array.from(new Set(labels)).sort((a, b) => a.localeCompare(b)).slice(0, 10);
    } else {
      // Backfill: if the user hasn't selected expertise tags yet, derive lightweight matches
      // from their existing skills/occupation text. This keeps discovery useful immediately.
      const rawSkills = [target.skills, target.occupation, target.jobTitle]
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .join(" ");
      const skillsLower = rawSkills.toLowerCase();
      if (skillsLower.trim().length) {
        const allExpertise = await masterDataService.listPublicItems({ typeCode: "EXPERTISE" });
        const matched = allExpertise
          .filter((i) => {
            const labelLower = (i.label ?? "").toLowerCase();
            const labelHit =
              labelLower.includes(skillsLower) || skillsLower.includes(labelLower);
            const aliasHit = Array.isArray(i.aliases)
              ? i.aliases.some((a) => (a ?? "").toLowerCase().includes(skillsLower))
              : false;
            return (
              labelHit ||
              aliasHit ||
              false
            );
          })
          .map((i) => i.label)
          .filter(Boolean);
        expertiseTags = Array.from(new Set(matched)).sort((a, b) => a.localeCompare(b)).slice(0, 10);
      }
    }
  }

  return {
    id: target.id,
    fullName: target.fullName,
    username: target.username ?? "",
    profileImage,
    city: target.city ?? null,
    district: target.district ?? null,
    community: target.community ?? null,
    kulam: target.kulam ?? null,
    occupation: target.occupation ?? null,
    communityRole: target.communityRole ?? null,

    profession: canViewProfessionalIdentity
      ? identityRow?.profession ?? target.occupation ?? (target.jobTitle ?? null)
      : null,
    company: canViewProfessionalIdentity
      ? identityRow?.company ?? (target.company ?? null)
      : null,
    experience: canViewProfessionalIdentity ? identityRow?.experience ?? null : null,
    expertiseTags: canViewProfessionalIdentity ? expertiseTags : [],
    availableForHelp: canViewProfessionalIdentity ? (identityRow?.availableForHelp ?? null) : null,

    memberSince: target.createdAt.toISOString(),
    profileVisibility: target.profileVisibility ?? "PUBLIC",
    isPrivatePreview: false,
    isSelf,
    needsUsernameSetup,
    relationshipStatus,
    acceptsConnectionRequests: target.allowConnectionRequests !== false,
    stats,
    connectedSince,
    canViewPosts: canViewerSeePosts({
      isSelf,
      isPrivate,
      isConnected,
      needsUsernameSetup
    })
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

/**
 * Paginated posts for a member profile timeline.
 * Respects private profiles; does not alter Home Feed ranking.
 */
export async function getMemberPosts(
  viewerId: number,
  identifier: string,
  limit: number,
  offset: number
): Promise<MemberPostsResultDto> {
  const target = await resolveTarget(identifier);
  if (!target || target.status !== "APPROVED") {
    throw Object.assign(new Error("Member not found."), { status: 404, code: "MEMBER_NOT_FOUND" });
  }

  const blocked = await getBlockedUserIds(viewerId);
  if (blocked.has(target.id)) {
    throw Object.assign(new Error("This profile is not available."), {
      status: 403,
      code: "PROFILE_BLOCKED"
    });
  }

  const isSelf = viewerId === target.id;
  const needsUsernameSetup = !target.username;
  const isPrivate = target.profileVisibility === "PRIVATE";
  const relationshipStatus =
    isSelf || needsUsernameSetup
      ? ("none" as RelationshipStatus)
      : await getRelationshipStatus(viewerId, target.id);
  const isConnected = relationshipStatus === "connected";
  const canView = canViewerSeePosts({ isSelf, isPrivate, isConnected, needsUsernameSetup });

  if (!canView) {
    return { items: [], total: 0, limit, offset, hasMore: false, canViewPosts: false };
  }

  const where = andWhere(
    isSelf
      ? { userId: target.id }
      : {
          userId: target.id,
          [Op.or]: [
            { postType: { [Op.ne]: "MARKETPLACE" } },
            { marketplaceStatus: "LIVE" }
          ]
        },
    await audienceVisibilityWhere(viewerId, "profile", {
      authorId: target.id,
      isConnectedToAuthor: isConnected,
      isSelf
    })
  );

  const connectionsOnlyHiddenCount =
    !isSelf && !isConnected
      ? await Post.count({
          where: {
            userId: target.id,
            visibility: "CONNECTIONS",
            [Op.or]: [
              { postType: { [Op.ne]: "MARKETPLACE" } },
              { marketplaceStatus: "LIVE" }
            ]
          }
        })
      : 0;

  const { count, rows: posts } = await Post.findAndCountAll({
    where,
    order: [
      ["createdAt", "DESC"],
      ["id", "DESC"]
    ],
    limit,
    offset,
    attributes: [
      "id",
      "postType",
      "title",
      "description",
      "mediaUrl",
      "mediaType",
      "thumbnailUrl",
      "videoDuration",
      "mimeType",
      "jobStatus",
      "originalPostId",
      "createdAt"
    ]
  });

  const postIds = posts.map((p) => p.id);
  if (postIds.length === 0) {
    return { items: [], total: count, limit, offset, hasMore: false, canViewPosts: true };
  }

  const originalIds = [
    ...new Set(
      posts
        .map((p) => p.originalPostId)
        .filter((id): id is number => typeof id === "number" && id > 0)
    )
  ];
  const originalPosts =
    originalIds.length > 0
      ? await Post.findAll({
          where: { id: { [Op.in]: originalIds } },
          include: [
            {
              association: "User",
              attributes: ["id", "fullName"],
              required: true
            }
          ]
        })
      : [];
  const originalById = new Map(originalPosts.map((op) => [op.id, op]));

  const [likeRows, commentRows, myLikes, mySaves] = await Promise.all([
    PostLike.findAll({
      where: { postId: { [Op.in]: postIds } },
      attributes: ["postId"],
      raw: true
    }),
    Comment.findAll({
      where: { postId: { [Op.in]: postIds } },
      attributes: ["postId"],
      raw: true
    }),
    PostLike.findAll({
      where: { postId: { [Op.in]: postIds }, userId: viewerId },
      attributes: ["postId"],
      raw: true
    }),
    SavedPost.findAll({
      where: { postId: { [Op.in]: postIds }, userId: viewerId },
      attributes: ["postId"],
      raw: true
    })
  ]);

  const tally = (rows: { postId: number }[]) => {
    const m: Record<number, number> = {};
    postIds.forEach((id) => (m[id] = 0));
    rows.forEach((r) => {
      m[r.postId] = (m[r.postId] || 0) + 1;
    });
    return m;
  };

  const likesMap = tally(likeRows as { postId: number }[]);
  const commentsMap = tally(commentRows as { postId: number }[]);
  const likedSet = new Set((myLikes as { postId: number }[]).map((r) => r.postId));
  const savedSet = new Set((mySaves as { postId: number }[]).map((r) => r.postId));

  const items: MemberPostItemDto[] = await Promise.all(
    posts.map(async (p) => {
      const [mediaUrl, thumbnailUrl] = await Promise.all([
        toSignedUrlIfR2(p.mediaUrl ?? null),
        toSignedUrlIfR2(p.thumbnailUrl ?? null)
      ]);
      const mediaType = resolvePostMediaType({
        mediaUrl: p.mediaUrl,
        mediaType: p.mediaType as PostMediaType,
        mimeType: p.mimeType
      });
      const original = p.originalPostId ? originalById.get(p.originalPostId) : null;
      const originalUser = original ? ((original as any).User as User) : null;
      return {
        postId: p.id,
        postType: p.postType,
        title: p.title,
        description: p.description ?? null,
        mediaUrl,
        mediaType,
        thumbnailUrl,
        videoDuration: p.videoDuration ?? null,
        createdAt: p.createdAt.toISOString(),
        counts: {
          likes: likesMap[p.id] ?? 0,
          comments: commentsMap[p.id] ?? 0
        },
        likedByMe: likedSet.has(p.id),
        savedByMe: savedSet.has(p.id),
        isRepost: Boolean(p.originalPostId),
        originalPostId: p.originalPostId ?? null,
        originalAuthorName: originalUser?.fullName ?? null
      };
    })
  );

  return {
    items,
    total: count,
    limit,
    offset,
    hasMore: offset + posts.length < count,
    canViewPosts: true,
    ...(connectionsOnlyHiddenCount > 0 ? { connectionsOnlyHiddenCount } : {})
  };
}

export const memberProfileService = {
  getMemberProfile,
  getMemberPosts,
  updateProfileVisibility,
  updateAllowConnectionRequests,
  listBlockedMembers
};
