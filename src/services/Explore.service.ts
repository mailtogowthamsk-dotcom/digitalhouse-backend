import { Op, type WhereOptions } from "sequelize";
import { User, Post } from "../models";
import type { FeedItemDto } from "./Home.service";
import { buildFeedItemsFromPosts } from "./Feed.service";
import { findPostIdsByTagTokens, getTrendingHashtags } from "./Hashtag.service";
import { tokenizeSearchQuery, escapeLike } from "../utils/hashtagParser";
import { audienceVisibilityWhere } from "./PostVisibility.service";

const APPROVED = "APPROVED";

export type ExploreSearchParams = {
  q: string;
  page?: number;
  limit?: number;
};

export type ExploreSearchResult = {
  items: FeedItemDto[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  query: string;
};

export type ExploreDiscoveryDto = {
  trendingHashtags: Array<{ tag: string; usageCount: number }>;
  /** Future: trending searches, suggested topics, featured posts */
  suggestedTopics: Array<{ id: string; label: string }>;
};

async function approvedUserIdsInCommunity(currentUserId: number): Promise<number[]> {
  const me = await User.findByPk(currentUserId, { attributes: ["community"] });
  const community = me?.community ?? null;
  const users = await User.findAll({
    where: { status: APPROVED, community },
    attributes: ["id"]
  });
  return users.map((u) => u.id);
}

function publicPostVisibilityFilter(): WhereOptions {
  return {
    [Op.and]: [
      {
        [Op.or]: [{ postType: { [Op.ne]: "MARKETPLACE" } }, { marketplaceStatus: "LIVE" }]
      },
      {
        [Op.or]: [
          { postType: { [Op.ne]: "HELP_REQUEST" } },
          { helpStatus: { [Op.in]: ["OPEN", "IN_PROGRESS"] } },
          { helpStatus: null }
        ]
      }
    ]
  };
}

/**
 * Multi-field explore search: title, description, hashtags, author name.
 * Multiple keywords are AND'd; each keyword may match any field (OR).
 */
export async function searchExplore(
  currentUserId: number,
  params: ExploreSearchParams
): Promise<ExploreSearchResult> {
  const page = Math.max(params.page ?? 1, 1);
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
  const query = params.q.trim();
  const tokens = tokenizeSearchQuery(query);

  if (tokens.length === 0) {
    return { items: [], page, limit, total: 0, hasMore: false, query };
  }

  const approvedIds = await approvedUserIdsInCommunity(currentUserId);
  if (approvedIds.length === 0) {
    return { items: [], page, limit, total: 0, hasMore: false, query };
  }

  const hashtagPostMap = await findPostIdsByTagTokens(tokens);

  const authorMatches = await User.findAll({
    where: {
      id: { [Op.in]: approvedIds },
      [Op.or]: tokens.map((t) => ({
        fullName: { [Op.like]: `%${escapeLike(t)}%` }
      }))
    },
    attributes: ["id", "fullName"]
  });

  const authorIdsByToken = new Map<string, number[]>();
  for (const token of tokens) {
    const ids = authorMatches
      .filter((u) => (u.fullName ?? "").toLowerCase().includes(token))
      .map((u) => u.id);
    authorIdsByToken.set(token, ids);
  }

  const tokenClauses: WhereOptions[] = tokens.map((token) => {
    const like = `%${escapeLike(token)}%`;
    const hashtagIds = hashtagPostMap.get(token) ?? [];
    const authorIds = authorIdsByToken.get(token) ?? [];
    const orParts: WhereOptions[] = [
      { title: { [Op.like]: like } },
      { description: { [Op.like]: like } }
    ];
    if (hashtagIds.length > 0) {
      orParts.push({ id: { [Op.in]: hashtagIds } });
    }
    if (authorIds.length > 0) {
      orParts.push({ userId: { [Op.in]: authorIds } });
    }
    return { [Op.or]: orParts };
  });

  const where: WhereOptions = {
    [Op.and]: [
      { userId: { [Op.in]: approvedIds } },
      publicPostVisibilityFilter(),
      await audienceVisibilityWhere(currentUserId, "discovery"),
      ...tokenClauses
    ]
  };

  const total = await Post.count({ where });
  const offset = (page - 1) * limit;

  const posts = await Post.findAll({
    where,
    include: [
      {
        association: "User",
        attributes: ["id", "fullName", "profilePhoto", "status"],
        required: true
      }
    ],
    order: [
      ["createdAt", "DESC"],
      ["id", "DESC"]
    ],
    limit,
    offset
  });

  const items = await buildFeedItemsFromPosts(posts, currentUserId);
  return {
    items,
    page,
    limit,
    total,
    hasMore: offset + items.length < total,
    query
  };
}

export async function getExploreDiscovery(_currentUserId: number): Promise<ExploreDiscoveryDto> {
  const trendingHashtags = await getTrendingHashtags(12);
  return {
    trendingHashtags,
    suggestedTopics: []
  };
}

export const exploreService = {
  searchExplore,
  getExploreDiscovery
};
