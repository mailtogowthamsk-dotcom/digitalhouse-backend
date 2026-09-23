import { Op, type WhereOptions } from "sequelize";
import {
  Comment,
  Hashtag,
  MemberExpertiseSelection,
  MasterDataItem,
  Post,
  PostHashtag,
  PostLike,
  SavedPost,
  UserProfile
} from "../../models";
import { applyPostFilters, engagementScoreSql, FEED_POST_ATTRIBUTES } from "../Feed.service";
import { audienceVisibilityWhere, getAcceptedConnectionUserIds } from "../PostVisibility.service";
import { FEED_RANKING_CONFIG as CFG } from "./config";
import { allSettledWithConcurrency, feedCandidateConcurrency } from "./feedConcurrency";
import type { CandidateSource, FeedCandidate, ViewerAffinity } from "./types";
import { mergeCandidate } from "./math";

const APPROVED = "APPROVED";

const CANDIDATE_ATTRS = ["id", "userId", "createdAt", "likeCount", "commentCount", "postType"] as const;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 3600 * 1000);
}

function toCandidate(p: Post, source: CandidateSource): FeedCandidate | null {
  if (!p?.id || !p.userId || !p.createdAt) return null;
  return {
    postId: p.id,
    authorId: p.userId,
    createdAt: p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt),
    likeCount: Number(p.likeCount) || 0,
    commentCount: Number(p.commentCount) || 0,
    postType: String(p.postType || ""),
    sources: [source]
  };
}

function userInclude(community: string | null) {
  return {
    association: "User" as const,
    attributes: [] as string[],
    required: true as const,
    where: {
      status: APPROVED,
      ...(community != null ? { community } : { community: null })
    }
  };
}

export async function buildEligibleWhere(
  currentUserId: number,
  preload?: { connectedIds?: number[]; blockedIds?: Set<number> }
): Promise<WhereOptions> {
  const visibility = await audienceVisibilityWhere(currentUserId, "feed", preload);
  return applyPostFilters(visibility, {}, currentUserId);
}

async function findCandidates(opts: {
  where: WhereOptions;
  community: string | null;
  source: CandidateSource;
  limit: number;
  offset?: number;
  order?: any;
  createdAfter?: Date;
}): Promise<FeedCandidate[]> {
  if (opts.limit <= 0) return [];
  const where: WhereOptions = opts.createdAfter
    ? { [Op.and]: [opts.where, { createdAt: { [Op.gte]: opts.createdAfter } }] }
    : opts.where;
  try {
    const rows = await Post.findAll({
      where,
      include: [userInclude(opts.community)],
      attributes: [...CANDIDATE_ATTRS],
      order: opts.order ?? [
        ["createdAt", "DESC"],
        ["id", "DESC"]
      ],
      limit: opts.limit,
      offset: opts.offset ?? 0
    });
    const out: FeedCandidate[] = [];
    for (const p of rows) {
      const c = toCandidate(p, opts.source);
      if (c) out.push(c);
    }
    return out;
  } catch {
    return [];
  }
}

export async function loadViewerAffinity(
  currentUserId: number,
  preload?: { connectionIds?: number[] }
): Promise<{ affinity: ViewerAffinity; queryCount: number }> {
  let queryCount = 0;
  const connectionIds =
    preload?.connectionIds ?? (await getAcceptedConnectionUserIds(currentUserId));
  if (!preload?.connectionIds) queryCount += 1;

  // Same 5 preference queries as before — pool max=3 naturally waves them.
  // (Do not artificially serialize further; that only adds latency when the pool is free.)
  const [likeRows, commentRows, saveRows, expertiseRows, profile] = await Promise.all([
    PostLike.findAll({
      where: { userId: currentUserId },
      attributes: ["postId"],
      order: [["createdAt", "DESC"]],
      limit: CFG.affinity.maxLikedPosts,
      raw: true
    }).catch(() => [] as Array<{ postId: number }>),
    Comment.findAll({
      where: { userId: currentUserId },
      attributes: ["postId"],
      order: [["createdAt", "DESC"]],
      limit: CFG.affinity.maxCommentedPosts,
      raw: true
    }).catch(() => [] as Array<{ postId: number }>),
    SavedPost.findAll({
      where: { userId: currentUserId },
      attributes: ["postId"],
      order: [["createdAt", "DESC"]],
      limit: CFG.affinity.maxSavedPosts,
      raw: true
    }).catch(() => [] as Array<{ postId: number }>),
    MemberExpertiseSelection.findAll({
      where: { userId: currentUserId },
      attributes: ["expertiseItemId"],
      limit: 40,
      raw: true
    }).catch(() => [] as Array<{ expertiseItemId: number }>),
    UserProfile.findOne({
      where: { userId: currentUserId },
      attributes: ["personal"]
    }).catch(() => null)
  ]);
  queryCount += 5;

  /** Preference evidence only — these IDs are not a candidate source. */
  const engagedPostIds = [
    ...new Set(
      [...likeRows, ...commentRows, ...saveRows]
        .map((r) => r.postId)
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  ];

  const hashtagIds = new Set<number>();
  const tokens = new Set<string>();
  const hobbies = profile?.personal && typeof profile.personal === "object" ? profile.personal.hobbies : null;
  if (typeof hobbies === "string" && hobbies.trim()) {
    for (const part of hobbies.split(/[,/|;]+/)) {
      const t = part.trim().toLowerCase().replace(/^#/, "");
      if (t.length >= 2 && t.length <= 64) tokens.add(t);
    }
  }

  // P4C: PostHashtag(engaged) and MasterData labels are independent — run together (was sequential).
  const [links, expertiseItems] = await Promise.all([
    engagedPostIds.length > 0
      ? PostHashtag.findAll({
          where: { postId: { [Op.in]: engagedPostIds } },
          attributes: ["hashtagId"],
          raw: true
        }).catch(() => [] as Array<{ hashtagId: number }>)
      : Promise.resolve([] as Array<{ hashtagId: number }>),
    expertiseRows.length > 0
      ? MasterDataItem.findAll({
          where: { id: { [Op.in]: expertiseRows.map((r) => r.expertiseItemId) } },
          attributes: ["label"]
        }).catch(() => [] as MasterDataItem[])
      : Promise.resolve([] as MasterDataItem[])
  ]);
  if (engagedPostIds.length > 0) queryCount += 1;
  if (expertiseRows.length > 0) queryCount += 1;
  for (const l of links) hashtagIds.add(l.hashtagId);
  for (const it of expertiseItems) {
    const t = String(it.label || "")
      .trim()
      .toLowerCase();
    if (t.length >= 2) tokens.add(t);
  }

  if (tokens.size > 0 && hashtagIds.size < CFG.affinity.maxHashtagIds) {
    const tags = await Hashtag.findAll({
      where: { tag: { [Op.in]: [...tokens] } },
      attributes: ["id"],
      limit: CFG.affinity.maxHashtagIds,
      raw: true
    }).catch(() => [] as Array<{ id: number }>);
    queryCount += 1;
    for (const t of tags) hashtagIds.add(t.id);
  }

  while (hashtagIds.size > CFG.affinity.maxHashtagIds) {
    const last = [...hashtagIds].pop();
    if (last == null) break;
    hashtagIds.delete(last);
  }

  return {
    queryCount,
    affinity: {
      connectionIds: new Set(connectionIds.slice(0, CFG.affinity.maxConnectionIds)),
      hashtagIds,
      likeCount: likeRows.length,
      commentCount: commentRows.length,
      connectionCount: connectionIds.length
    }
  };
}

async function connectionCandidates(
  where: WhereOptions,
  community: string | null,
  connectionIds: number[]
): Promise<FeedCandidate[]> {
  if (connectionIds.length === 0) return [];
  return findCandidates({
    where: { [Op.and]: [where, { userId: { [Op.in]: connectionIds } }] },
    community,
    source: "connection",
    limit: CFG.sourceMax.connection
  });
}

/** Hashtag → post IDs for interest source (separate from findCandidates so fan-out stays 1 query each). */
async function interestPostIds(hashtagIds: number[]): Promise<number[]> {
  if (hashtagIds.length === 0) return [];
  const links = await PostHashtag.findAll({
    where: { hashtagId: { [Op.in]: hashtagIds } },
    attributes: ["postId"],
    limit: CFG.sourceMax.interest * 8,
    raw: true
  }).catch(() => [] as Array<{ postId: number }>);
  return [...new Set(links.map((l) => l.postId))];
}

async function interestCandidatesFromIds(
  where: WhereOptions,
  community: string | null,
  postIds: number[]
): Promise<FeedCandidate[]> {
  if (postIds.length === 0) return [];
  return findCandidates({
    where: { [Op.and]: [where, { id: { [Op.in]: postIds.slice(0, 320) } }] },
    community,
    source: "interest",
    limit: CFG.sourceMax.interest
  });
}

async function discoveryCandidates(where: WhereOptions, community: string | null): Promise<FeedCandidate[]> {
  const scoreSql = engagementScoreSql();
  return findCandidates({
    where,
    community,
    source: "discovery",
    limit: CFG.sourceMax.discovery,
    createdAfter: daysAgo(CFG.lookbackDays.discovery),
    order: [
      [scoreSql, "DESC"],
      ["createdAt", "DESC"],
      ["id", "DESC"]
    ]
  });
}

export async function retrieveCandidates(params: {
  currentUserId: number;
  community: string | null;
  affinity: ViewerAffinity;
  seed: number;
  /** Prebuilt eligibility WHERE — avoids reloading connections/blocks per source. */
  eligibleWhere?: WhereOptions;
}): Promise<{ candidates: FeedCandidate[]; queryCount: number; sourceCounts: Record<string, number> }> {
  const where = params.eligibleWhere ?? (await buildEligibleWhere(params.currentUserId));
  const whereQueryCost = params.eligibleWhere ? 0 : 1;
  const connectionIds = [...params.affinity.connectionIds];
  const hashtagIds = [...params.affinity.hashtagIds];
  const exploreOffset = params.seed % CFG.explorationOffsetModulo;

  // Prefetch interest post IDs before the source fan-out so each source is one Post.findAll
  // (previously interest nested PostHashtag + findAll inside Promise.allSettled → 2 RTTs on that branch).
  let interestIds: number[] = [];
  let interestLookupQueries = 0;
  if (hashtagIds.length > 0) {
    interestIds = await interestPostIds(hashtagIds);
    interestLookupQueries = 1;
  }

  const sourceTasks: Array<() => Promise<FeedCandidate[]>> = [
    () => connectionCandidates(where, params.community, connectionIds),
    () => interestCandidatesFromIds(where, params.community, interestIds),
    () =>
      findCandidates({
        where,
        community: params.community,
        source: "fresh",
        limit: CFG.sourceMax.fresh,
        createdAfter: daysAgo(CFG.lookbackDays.fresh)
      }),
    () => discoveryCandidates(where, params.community),
    () =>
      findCandidates({
        where,
        community: params.community,
        source: "exploration",
        limit: CFG.sourceMax.exploration,
        offset: exploreOffset,
        createdAfter: daysAgo(CFG.lookbackDays.exploration)
      })
  ];

  // Cap in-flight source queries (default 2) so pool max=3 is not saturated by feed alone
  // when /auth/me + /legal/status + ads overlap. Same result set as unbounded Promise.allSettled.
  const settled = await allSettledWithConcurrency(sourceTasks, feedCandidateConcurrency());

  const sourceCounts: Record<string, number> = {
    connection: 0,
    interest: 0,
    fresh: 0,
    discovery: 0,
    exploration: 0
  };
  const byId = new Map<number, FeedCandidate>();
  const labels: Array<keyof typeof sourceCounts> = [
    "connection",
    "interest",
    "fresh",
    "discovery",
    "exploration"
  ];
  settled.forEach((result, i) => {
    const label = labels[i]!;
    if (result.status !== "fulfilled") return;
    sourceCounts[label] = result.value.length;
    for (const c of result.value) {
      byId.set(c.postId, mergeCandidate(byId.get(c.postId), c));
    }
  });

  return {
    candidates: [...byId.values()],
    // eligible where (unless preloaded) + interest hashtag lookup + 5 source queries
    queryCount: whereQueryCost + interestLookupQueries + 5,
    sourceCounts
  };
}

export async function loadTagOverlaps(postIds: number[], userHashtagIds: Set<number>): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (postIds.length === 0 || userHashtagIds.size === 0) return map;
  // Push affinity filter into SQL — same overlap counts, less row transfer than fetch-all-then-filter.
  const links = await PostHashtag.findAll({
    where: {
      postId: { [Op.in]: postIds },
      hashtagId: { [Op.in]: [...userHashtagIds] }
    },
    attributes: ["postId", "hashtagId"],
    raw: true
  }).catch(() => [] as Array<{ postId: number; hashtagId: number }>);
  for (const l of links) {
    map.set(l.postId, (map.get(l.postId) || 0) + 1);
  }
  return map;
}

export async function fallbackFreshCandidates(
  currentUserId: number,
  community: string | null,
  excludeIds: Set<number>,
  need: number,
  eligibleWhere?: WhereOptions
): Promise<FeedCandidate[]> {
  if (need <= 0) return [];
  const where = eligibleWhere ?? (await buildEligibleWhere(currentUserId));
  const extra = await findCandidates({
    where: excludeIds.size ? { [Op.and]: [where, { id: { [Op.notIn]: [...excludeIds].slice(0, 500) } }] } : where,
    community,
    source: "fallback",
    limit: need,
    createdAfter: daysAgo(CFG.lookbackDays.fresh)
  });
  return extra;
}

export async function fetchChronoTail(params: {
  currentUserId: number;
  community: string | null;
  excludeIds: number[];
  limit: number;
  after?: { createdAt: Date; postId: number } | null;
  eligibleWhere?: WhereOptions;
}): Promise<{ posts: Post[]; hasMore: boolean }> {
  if (params.limit <= 0) return { posts: [], hasMore: false };
  const where = params.eligibleWhere ?? (await buildEligibleWhere(params.currentUserId));
  const parts: WhereOptions[] = [where];
  if (params.excludeIds.length > 0) {
    parts.push({ id: { [Op.notIn]: params.excludeIds.slice(0, 200) } });
  }
  if (params.after && params.after.postId > 0) {
    parts.push({
      [Op.or]: [
        { createdAt: { [Op.lt]: params.after.createdAt } },
        { createdAt: params.after.createdAt, id: { [Op.lt]: params.after.postId } }
      ]
    });
  }
  try {
    const rows = await Post.findAll({
      where: { [Op.and]: parts },
      include: [
        {
          association: "User",
          attributes: ["id", "fullName", "profilePhoto", "status", "username"],
          required: true,
          where: {
            status: APPROVED,
            ...(params.community != null ? { community: params.community } : { community: null })
          }
        }
      ],
      attributes: [...FEED_POST_ATTRIBUTES] as any,
      order: [
        ["createdAt", "DESC"],
        ["id", "DESC"]
      ],
      limit: params.limit + 1
    });
    const hasMore = rows.length > params.limit;
    return { posts: hasMore ? rows.slice(0, params.limit) : rows, hasMore };
  } catch {
    return { posts: [], hasMore: false };
  }
}
