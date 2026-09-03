import { User } from "../../models";
import type { FeedQueryParams, FeedSortMode } from "../Feed.service";
import { buildFeedItemsFromPosts, FEED_POST_ATTRIBUTES } from "../Feed.service";
import { Post } from "../../models";
import { Op } from "sequelize";
import { FEED_RANKING_CONFIG as CFG } from "./config";
import { decodeFeedCursor, encodeFeedCursor, encodeTailStartCursor, isOpaqueFeedCursor, makeSessionContext } from "./cursor";
import { logFeedMetrics } from "./flag";
import {
  fallbackFreshCandidates,
  fetchChronoTail,
  loadTagOverlaps,
  loadViewerAffinity,
  retrieveCandidates
} from "./candidates";
import { loadExposuresForPosts } from "./exposureWrite";
import { planFeedPage } from "./pagination";
import {
  applySoftDiversity,
  coldStartTier,
  compareRanked,
  personalizationScales
} from "./math";
import { scoreHomeFeedCandidate } from "./signals";
import type { ScoredCandidate } from "./types";

const APPROVED = "APPROVED";

async function viewerCommunity(currentUserId: number): Promise<string | null> {
  const me = await User.findByPk(currentUserId, { attributes: ["community"] });
  return me?.community ?? null;
}

async function hydrateRanked(
  ranked: ScoredCandidate[],
  currentUserId: number,
  community: string | null,
  limit: number
): Promise<Post[]> {
  const want = Math.min(ranked.length, limit + CFG.hydrateBuffer);
  const ids = ranked.slice(0, want).map((r) => r.postId);
  if (ids.length === 0) return [];
  const rows = await Post.findAll({
    where: { id: { [Op.in]: ids } },
    include: [
      {
        association: "User",
        attributes: ["id", "fullName", "profilePhoto", "status", "username"],
        required: true,
        where: {
          status: APPROVED,
          ...(community != null ? { community } : { community: null })
        }
      }
    ],
    attributes: [...FEED_POST_ATTRIBUTES] as any
  });
  const byId = new Map(rows.map((p) => [p.id, p]));
  const ordered: Post[] = [];
  for (const r of ranked) {
    const p = byId.get(r.postId);
    if (p) ordered.push(p);
    if (ordered.length >= limit) break;
  }
  return ordered;
}

export async function getPersonalizedFeed(
  params: FeedQueryParams,
  currentUserId: number
): Promise<{
  items: Awaited<ReturnType<typeof buildFeedItemsFromPosts>>;
  page: number;
  limit: number;
  total: number;
  nextCursor: number | string | null;
  sort: FeedSortMode;
}> {
  const started = Date.now();
  let queryCount = 0;
  const limit = Math.min(Math.max(params.limit, 1), 50);
  const page = params.page ?? 1;
  const incomingCursor = isOpaqueFeedCursor(params.cursor) ? decodeFeedCursor(String(params.cursor)) : null;
  const session = makeSessionContext(incomingCursor?.sessionId);

  const chronoFallback = async (reason: string) => {
    logFeedMetrics({
      mode: "fallback",
      fallback: reason,
      ms: Date.now() - started,
      queryCount
    });
    const { getFeed } = await import("../Feed.service");
    return getFeed({ ...params, sort: "recent" }, currentUserId, { skipPersonalized: true });
  };

  try {
    const community = await viewerCommunity(currentUserId);
    queryCount += 1;

    const { affinity, queryCount: affinityQueries } = await loadViewerAffinity(currentUserId);
    queryCount += affinityQueries;

    const retrieved = await retrieveCandidates({
      currentUserId,
      community,
      affinity,
      seed: session.seed
    });
    queryCount += retrieved.queryCount;

    let pool = retrieved.candidates;
    if (pool.length < CFG.emptyFallbackMin) {
      const extra = await fallbackFreshCandidates(
        currentUserId,
        community,
        new Set(pool.map((c) => c.postId)),
        CFG.emptyFallbackMin - pool.length + limit
      );
      queryCount += 1;
      const byId = new Map(pool.map((c) => [c.postId, c]));
      for (const c of extra) {
        if (!byId.has(c.postId)) {
          byId.set(c.postId, c);
          pool.push(c);
        }
      }
      pool = [...byId.values()];
    }

    if (pool.length === 0) {
      const tail = await fetchChronoTail({
        currentUserId,
        community,
        excludeIds: [],
        limit,
        after:
          incomingCursor?.phase === "tail" && incomingCursor.postId > 0
            ? { createdAt: new Date(incomingCursor.tieBreaker), postId: incomingCursor.postId }
            : null
      });
      const items = await buildFeedItemsFromPosts(tail.posts, currentUserId);
      const last = tail.posts[tail.posts.length - 1];
      return {
        items,
        page,
        limit,
        total: tail.hasMore ? page * limit + 1 : items.length,
        nextCursor:
          tail.hasMore && last
            ? encodeFeedCursor({
                session,
                score: 0,
                createdAt: last.createdAt,
                postId: last.id,
                phase: "tail"
              })
            : null,
        sort: "recent"
      };
    }

    const now = new Date();
    const tier = coldStartTier({
      connectionCount: affinity.connectionCount,
      likeCount: affinity.likeCount,
      commentCount: affinity.commentCount,
      hashtagCount: affinity.hashtagIds.size
    });
    const scales = personalizationScales(tier);

    const overlaps = await loadTagOverlaps(
      pool.map((c) => c.postId),
      affinity.hashtagIds
    );
    queryCount += affinity.hashtagIds.size > 0 ? 1 : 0;

    const stage1: ScoredCandidate[] = pool.map((c) =>
      scoreHomeFeedCandidate({
        candidate: c,
        viewerId: currentUserId,
        now,
        connectionIds: affinity.connectionIds,
        tagOverlap: overlaps.get(c.postId) || 0,
        userTagCount: affinity.hashtagIds.size,
        scales
      })
    );
    stage1.sort((a, b) => compareRanked(a, b));
    const stage1Cut = stage1.slice(0, CFG.stage1Max);
    const rankedPool = stage1Cut.slice(0, CFG.stage2Max);

    const exposures = await loadExposuresForPosts(
      currentUserId,
      rankedPool.map((c) => c.postId)
    );
    queryCount += 1;

    const stage2: ScoredCandidate[] = rankedPool.map((c) =>
      scoreHomeFeedCandidate({
        candidate: c,
        viewerId: currentUserId,
        now,
        connectionIds: affinity.connectionIds,
        tagOverlap: overlaps.get(c.postId) || 0,
        userTagCount: affinity.hashtagIds.size,
        scales,
        exposure: exposures.get(c.postId)
      })
    );
    stage2.sort((a, b) => compareRanked(a, b));
    const diversified = applySoftDiversity(stage2);
    diversified.sort(compareRanked);
    const rankedIds = diversified.map((c) => c.postId);

    const planned = planFeedPage(diversified, incomingCursor, limit);
    let pagePosts: Post[] = [];
    let nextCursor: string | null = null;
    let hasMore = planned.rankedHasMore;

    if (planned.rankedSlice.length > 0) {
      pagePosts = await hydrateRanked(planned.rankedSlice, currentUserId, community, limit);
      queryCount += 1;
    }

    if (planned.rankedHasMore) {
      const last = planned.rankedSlice[planned.rankedSlice.length - 1];
      nextCursor = last
        ? encodeFeedCursor({
            session,
            score: last.finalScore,
            createdAt: last.createdAt,
            postId: last.postId,
            phase: "ranked"
          })
        : null;
      hasMore = true;
    } else {
      const fill = Math.max(0, limit - pagePosts.length);
      if (fill > 0) {
        const tail = await fetchChronoTail({
          currentUserId,
          community,
          excludeIds: rankedIds,
          limit: fill,
          after: planned.tailAfter
        });
        queryCount += 1;
        pagePosts = pagePosts.concat(tail.posts);
        hasMore = tail.hasMore;
        const lastTail = tail.posts[tail.posts.length - 1];
        nextCursor = lastTail
          ? encodeFeedCursor({
              session,
              score: 0,
              createdAt: lastTail.createdAt,
              postId: lastTail.id,
              phase: "tail"
            })
          : null;
        if (!hasMore) nextCursor = null;
      } else {
        const peek = await fetchChronoTail({
          currentUserId,
          community,
          excludeIds: rankedIds,
          limit: 1,
          after: null
        });
        queryCount += 1;
        hasMore = peek.posts.length > 0 || peek.hasMore;
        nextCursor = hasMore ? encodeTailStartCursor(session) : null;
      }
    }

    const items = await buildFeedItemsFromPosts(pagePosts, currentUserId);
    queryCount += 5;

    logFeedMetrics({
      mode: "personalized",
      ms: Date.now() - started,
      queryCount,
      candidateCount: retrieved.candidates.length,
      eligibleCount: pool.length,
      stage1Count: stage1Cut.length,
      stage2Count: rankedPool.length,
      resultCount: items.length,
      sources: retrieved.sourceCounts,
      coldStart: tier
    });

    return {
      items,
      page,
      limit,
      total: hasMore ? page * limit + 1 : (page - 1) * limit + items.length,
      nextCursor,
      sort: "recent"
    };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[personalized-feed]", err instanceof Error ? err.message : err);
    }
    return chronoFallback("ranking_exception");
  }
}
