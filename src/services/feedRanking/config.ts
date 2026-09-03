/**
 * Centralized Home Feed ranking configuration.
 * Caps are UPPER BOUNDS (adaptive — never pad to fill).
 * Tune via this file only; do not scatter magic numbers.
 */
export const FEED_RANKING_VERSION = 1;

export const FEED_RANKING_CONFIG = {
  rankingVersion: FEED_RANKING_VERSION,

  /** Per-source maximums — retrieve up to N, never invent extras. */
  sourceMax: {
    connection: 40,
    interest: 40,
    fresh: 30,
    discovery: 20,
    exploration: 10
  },

  /**
   * After dedupe, Stage-1 keeps at most this many IDs.
   * Benchmark 100 vs 140 vs 200; prefer the smallest that preserves quality.
   */
  stage1Max: 140,
  /** Expensive Stage-2 scoring + diversity on the Stage-1 cut (not a hard feed size). */
  stage2Max: 140,
  /** Hydrate at most pageSize + this buffer (never the full candidate pool). */
  hydrateBuffer: 6,

  lookbackDays: {
    fresh: 21,
    discovery: 14,
    exploration: 21,
    interestLikes: 90
  },

  affinity: {
    /** Posts used only to derive hashtag/type affinity — never a "liked posts" candidate source. */
    maxLikedPosts: 40,
    maxCommentedPosts: 30,
    maxSavedPosts: 40,
    maxHashtagIds: 40,
    maxConnectionIds: 150
  },

  /**
   * Positive contributions. EngagementQuality is GLOBAL post popularity
   * (denormalized likeCount/commentCount), not "this viewer liked this post".
   * Exposure cap MUST stay strictly larger so recent seen cannot be cancelled by high likes.
   */
  weights: {
    interest: 28,
    connection: 22,
    freshness: 22,
    engagement: 16,
    quality: 0
  },

  /** Maximum contribution after weight × normalized signal. */
  caps: {
    interest: 28,
    connection: 22,
    freshness: 22,
    engagement: 16,
    quality: 0,
    exposure: 40,
    diversity: 8
  },

  freshnessHalfLifeHours: 36,
  /** log1p(rawEngagement) is divided by log1p(this). */
  engagementLogCap: 200,
  /** Mix freshness into engagement so old viral posts cannot lock the top. */
  engagementFreshnessMix: 0.7,

  exposure: {
    windowsHours: [
      { withinHours: 6, penalty: 1 },
      { withinHours: 24, penalty: 0.7 },
      { withinHours: 72, penalty: 0.35 },
      { withinHours: 168, penalty: 0.12 }
    ] as Array<{ withinHours: number; penalty: number }>,
    repeatBoostPerExtra: 0.08,
    maxRepeatBoost: 0.25
  },

  diversity: {
    authorPenalty: 0.12,
    consecutiveAuthorPenalty: 0.18,
    topicPenalty: 0.08,
    sourcePenalty: 0.05,
    consecutiveAuthorGuardrail: 5
  },

  coldStart: {
    /** Distinct evidence buckets (connections / 2+ likes / 2+ comments / 3+ tags). */
    limitedMaxBuckets: 2,
    interestScaleNone: 0,
    interestScaleLimited: 0.35,
    connectionScaleNone: 0,
    connectionScaleLimited: 0.45
  },

  explorationOffsetModulo: 17,
  emptyFallbackMin: 6
} as const;

export type FeedRankingConfig = typeof FEED_RANKING_CONFIG;

export const PERSONALIZED_FEED_FLAG = "personalized_feed";
