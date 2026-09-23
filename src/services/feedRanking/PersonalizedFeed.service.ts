import { User } from "../../models";
import type { FeedQueryParams, FeedSortMode } from "../Feed.service";
import { buildFeedItemsFromPosts, FEED_POST_ATTRIBUTES } from "../Feed.service";
import { Post } from "../../models";
import { Op } from "sequelize";
import { FEED_RANKING_CONFIG as CFG } from "./config";
import { decodeFeedCursor, encodeFeedCursor, encodeTailStartCursor, isOpaqueFeedCursor, makeSessionContext } from "./cursor";
import { logFeedMetrics } from "./flag";
import {
  buildEligibleWhere,
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
import { getAcceptedConnectionUserIds } from "../PostVisibility.service";
import { getBlockedUserIds } from "../MatrimonySafety.service";

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
    const { timedMs } = await import("../../utils/perfTimer");
    let preloadMs = 0;
    let affinityMs = 0;
    let candidateMs = 0;
    let fallbackMs = 0;
    let rankingMs = 0;
    let exposureMs = 0;
    let hydrateMs = 0;
    let mediaHydrateMs = 0;
    let serializeMs = 0;

    // Request-scoped context: community + full connection/block sets once.
    const preloadTimed = await timedMs(() =>
      Promise.all([
        viewerCommunity(currentUserId),
        getAcceptedConnectionUserIds(currentUserId),
        getBlockedUserIds(currentUserId).catch(() => new Set<number>())
      ])
    );
    preloadMs = preloadTimed.ms;
    const [community, connectionIds, blockedIds] = preloadTimed.value;
    queryCount += 3;

    const eligibleWhere = await buildEligibleWhere(currentUserId, {
      connectedIds: connectionIds,
      blockedIds
    });

    const affinityTimed = await timedMs(() =>
      loadViewerAffinity(currentUserId, { connectionIds })
    );
    affinityMs = affinityTimed.ms;
    const { affinity, queryCount: affinityQueries } = affinityTimed.value;
    queryCount += affinityQueries;

    const retrievedTimed = await timedMs(() =>
      retrieveCandidates({
        currentUserId,
        community,
        affinity,
        seed: session.seed,
        eligibleWhere
      })
    );
    candidateMs = retrievedTimed.ms;
    const retrieved = retrievedTimed.value;
    queryCount += retrieved.queryCount;

    let pool = retrieved.candidates;
    if (pool.length < CFG.emptyFallbackMin) {
      const fallbackTimed = await timedMs(() =>
        fallbackFreshCandidates(
          currentUserId,
          community,
          new Set(pool.map((c) => c.postId)),
          CFG.emptyFallbackMin - pool.length + limit,
          eligibleWhere
        )
      );
      fallbackMs = fallbackTimed.ms;
      const extra = fallbackTimed.value;
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
            : null,
        eligibleWhere
      });
      const itemsTimed = await timedMs(() => buildFeedItemsFromPosts(tail.posts, currentUserId));
      mediaHydrateMs = itemsTimed.ms;
      const items = itemsTimed.value;
      const last = tail.posts[tail.posts.length - 1];
      logFeedMetrics({
        mode: "personalized_empty_tail",
        totalMs: Date.now() - started,
        preloadMs,
        affinityMs,
        candidateMs,
        fallbackMs,
        mediaMs: mediaHydrateMs,
        queryCount,
        resultCount: items.length
      });
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

    const rankingStarted = Date.now();
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

    const exposureTimed = await timedMs(() =>
      loadExposuresForPosts(
        currentUserId,
        rankedPool.map((c) => c.postId)
      )
    );
    exposureMs = exposureTimed.ms;
    const exposures = exposureTimed.value;
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
    rankingMs = Date.now() - rankingStarted;
    const rankedIds = diversified.map((c) => c.postId);

    const planned = planFeedPage(diversified, incomingCursor, limit);
    let pagePosts: Post[] = [];
    let nextCursor: string | null = null;
    let hasMore = planned.rankedHasMore;

    if (planned.rankedSlice.length > 0) {
      const hydrateTimed = await timedMs(() =>
        hydrateRanked(planned.rankedSlice, currentUserId, community, limit)
      );
      hydrateMs = hydrateTimed.ms;
      pagePosts = hydrateTimed.value;
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
          after: planned.tailAfter,
          eligibleWhere
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
          after: null,
          eligibleWhere
        });
        queryCount += 1;
        hasMore = peek.posts.length > 0 || peek.hasMore;
        nextCursor = hasMore ? encodeTailStartCursor(session) : null;
      }
    }

    // buildFeedItemsFromPosts includes media batch resolution + DTO assembly
    const itemsTimed = await timedMs(() => buildFeedItemsFromPosts(pagePosts, currentUserId));
    mediaHydrateMs = itemsTimed.ms;
    const items = itemsTimed.value;
    queryCount += 5;

    const serializeStarted = Date.now();
    const result = {
      items,
      page,
      limit,
      total: hasMore ? page * limit + 1 : (page - 1) * limit + items.length,
      nextCursor,
      sort: "recent" as FeedSortMode
    };
    serializeMs = Date.now() - serializeStarted;

    logFeedMetrics({
      mode: "personalized",
      totalMs: Date.now() - started,
      preloadMs,
      affinityMs,
      candidateMs,
      fallbackMs,
      rankingMs,
      exposureMs,
      hydrateMs,
      mediaMs: mediaHydrateMs,
      serializeMs,
      queryCount,
      candidateCount: retrieved.candidates.length,
      eligibleCount: pool.length,
      stage1Count: stage1Cut.length,
      stage2Count: rankedPool.length,
      resultCount: items.length,
      sources: retrieved.sourceCounts,
      coldStart: tier
    });

    return result;
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[personalized-feed]", err instanceof Error ? err.message : err);
    }
    return chronoFallback("ranking_exception");
  }
}
