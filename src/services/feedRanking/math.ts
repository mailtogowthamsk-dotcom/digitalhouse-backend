import { FEED_RANKING_CONFIG as CFG } from "./config";
import type { CandidateSource, ExposureRow, FeedCandidate, ScoredCandidate } from "./types";

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

export function capContribution(value: number, cap: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(cap) || cap <= 0) return 0;
  return value > cap ? cap : value;
}

export function freshnessSignal(createdAt: Date, now: Date, halfLifeHours = CFG.freshnessHalfLifeHours): number {
  const ageMs = now.getTime() - createdAt.getTime();
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 1;
  const ageHours = ageMs / 3_600_000;
  const decay = Math.pow(2, -ageHours / Math.max(halfLifeHours, 1));
  return clamp01(decay);
}

export function rawEngagement(likeCount: number, commentCount: number): number {
  return Math.max(0, likeCount) * 2 + Math.max(0, commentCount) * 3;
}

  /** Log-normalized 0–1. GLOBAL like/comment counts only — not viewer likedByMe. */
export function engagementSignal(likeCount: number, commentCount: number, freshness: number): number {
  const raw = rawEngagement(likeCount, commentCount);
  const denom = Math.log1p(CFG.engagementLogCap);
  const logged = clamp01(denom > 0 ? Math.log1p(raw) / denom : 0);
  const mix = CFG.engagementFreshnessMix;
  return clamp01(logged * (1 - mix + mix * freshness));
}

/** Type/topic match. Not "this viewer liked this exact post". */
export function interestSignal(overlap: number, userTagCount: number): number {
  if (overlap <= 0 || userTagCount <= 0) return 0;
  const denom = Math.min(3, userTagCount);
  return clamp01(overlap / Math.max(denom, 1));
}

export function connectionSignal(authorId: number, viewerId: number, connectionIds: Set<number>): number {
  if (authorId === viewerId) return 0.35;
  return connectionIds.has(authorId) ? 1 : 0;
}

/**
 * Time-decayed exposure penalty 0–1. Seen ≠ excluded.
 * Viewer like/comment/save is NOT an impression and must not reduce this penalty.
 */
export function exposurePenaltySignal(row: ExposureRow | undefined, now: Date): number {
  if (!row?.lastSeenAt) return 0;
  const ageHours = (now.getTime() - row.lastSeenAt.getTime()) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours < 0) return 0;
  let base = 0;
  for (const window of CFG.exposure.windowsHours) {
    if (ageHours <= window.withinHours) {
      base = window.penalty;
      break;
    }
  }
  if (base === 0) return 0;
  const extra = Math.max(0, (row.impressionCount || 1) - 1);
  const repeat = Math.min(CFG.exposure.maxRepeatBoost, extra * CFG.exposure.repeatBoostPerExtra);
  return clamp01(base + repeat * base);
}

export type ColdStartTier = "none" | "limited" | "full";

export function coldStartTier(affinity: {
  connectionCount: number;
  likeCount: number;
  commentCount: number;
  hashtagCount: number;
}): ColdStartTier {
  let buckets = 0;
  if (affinity.connectionCount > 0) buckets += 1;
  if (affinity.likeCount >= 2) buckets += 1;
  if (affinity.commentCount >= 2) buckets += 1;
  if (affinity.hashtagCount >= 3) buckets += 1;
  if (buckets <= 0) return "none";
  if (buckets <= CFG.coldStart.limitedMaxBuckets) return "limited";
  return "full";
}

export function personalizationScales(tier: ColdStartTier): { interest: number; connection: number } {
  if (tier === "none") {
    return {
      interest: CFG.coldStart.interestScaleNone,
      connection: CFG.coldStart.connectionScaleNone
    };
  }
  if (tier === "limited") {
    return {
      interest: CFG.coldStart.interestScaleLimited,
      connection: CFG.coldStart.connectionScaleLimited
    };
  }
  return { interest: 1, connection: 1 };
}

export function scoreStage1(
  candidate: FeedCandidate,
  viewerId: number,
  now: Date,
  connectionIds: Set<number>,
  tagOverlap: number,
  userTagCount: number,
  scales: { interest: number; connection: number }
): Pick<
  ScoredCandidate,
  | "interest"
  | "connection"
  | "freshness"
  | "engagement"
  | "quality"
  | "interestContribution"
  | "connectionContribution"
  | "freshnessContribution"
  | "engagementContribution"
  | "qualityContribution"
  | "stage1Score"
> {
  const freshness = freshnessSignal(candidate.createdAt, now);
  const interest = interestSignal(tagOverlap, userTagCount) * scales.interest;
  const connection = connectionSignal(candidate.authorId, viewerId, connectionIds) * scales.connection;
  const engagement = engagementSignal(candidate.likeCount, candidate.commentCount, freshness);
  const quality = 0;

  const interestContribution = capContribution(interest * CFG.weights.interest, CFG.caps.interest);
  const connectionContribution = capContribution(connection * CFG.weights.connection, CFG.caps.connection);
  const freshnessContribution = capContribution(freshness * CFG.weights.freshness, CFG.caps.freshness);
  const engagementContribution = capContribution(engagement * CFG.weights.engagement, CFG.caps.engagement);
  const qualityContribution = capContribution(quality * CFG.weights.quality, CFG.caps.quality);

  return {
    interest,
    connection,
    freshness,
    engagement,
    quality,
    interestContribution,
    connectionContribution,
    freshnessContribution,
    engagementContribution,
    qualityContribution,
    stage1Score:
      interestContribution +
      connectionContribution +
      freshnessContribution +
      engagementContribution +
      qualityContribution
  };
}

export function applyExposureToScore(stage1Score: number, exposure: number): number {
  const penalty = capContribution(exposure * CFG.caps.exposure, CFG.caps.exposure);
  return stage1Score - penalty;
}

export function compareRanked(
  a: { finalScore: number; createdAt: Date; postId: number },
  b: { finalScore: number; createdAt: Date; postId: number }
): number {
  if (a.finalScore !== b.finalScore) return b.finalScore - a.finalScore;
  const at = a.createdAt.getTime();
  const bt = b.createdAt.getTime();
  if (at !== bt) return bt - at;
  return b.postId - a.postId;
}

export function isAfterCursor(
  item: { finalScore: number; createdAt: Date; postId: number },
  cursor: { score: number; tieBreaker: number; postId: number }
): boolean {
  if (item.finalScore !== cursor.score) return item.finalScore < cursor.score;
  const t = item.createdAt.getTime();
  if (t !== cursor.tieBreaker) return t < cursor.tieBreaker;
  return item.postId < cursor.postId;
}

function diversityPenaltyAgainstSelected(
  candidate: ScoredCandidate,
  selected: ScoredCandidate[]
): number {
  if (selected.length === 0) return 0;
  let p = 0;
  let authorCount = 0;
  for (const s of selected) {
    if (s.authorId === candidate.authorId) authorCount += 1;
  }
  if (authorCount > 0) p += CFG.diversity.authorPenalty * authorCount;
  const last = selected[selected.length - 1];
  if (last) {
    if (last.authorId === candidate.authorId) p += CFG.diversity.consecutiveAuthorPenalty;
    if (last.postType && last.postType === candidate.postType) p += CFG.diversity.topicPenalty;
    const lastSrc = last.sources[0];
    const candSrc = candidate.sources[0];
    if (lastSrc && candSrc && lastSrc === candSrc) p += CFG.diversity.sourcePenalty;
  }
  return capContribution(p * 10, CFG.caps.diversity);
}

/**
 * Soft greedy re-rank: relevance stays primary.
 * Same author/topic may repeat when still strongest after a small penalty.
 */
export function applySoftDiversity(items: ScoredCandidate[]): ScoredCandidate[] {
  if (items.length <= 1) return items;
  const remaining = [...items];
  const out: ScoredCandidate[] = [];
  const guard = CFG.diversity.consecutiveAuthorGuardrail;

  while (remaining.length) {
    let bestIdx = 0;
    let bestAdjusted = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const penalty = diversityPenaltyAgainstSelected(remaining[i]!, out);
      const adjusted = remaining[i]!.finalScore - penalty;
      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted;
        bestIdx = i;
      }
    }

    let pickIdx = bestIdx;
    const streakAuthor = remaining[pickIdx]!.authorId;
    let streak = 0;
    for (let i = out.length - 1; i >= 0 && out[i]!.authorId === streakAuthor; i--) streak += 1;
    if (streak >= guard - 1) {
      const alt = remaining.findIndex((r) => r.authorId !== streakAuthor);
      if (alt >= 0) pickIdx = alt;
    }

    const picked = remaining.splice(pickIdx, 1)[0]!;
    const diversityPenalty = diversityPenaltyAgainstSelected(picked, out);
    out.push({
      ...picked,
      diversityPenalty,
      finalScore: picked.finalScore - diversityPenalty + (picked.diversityPenalty || 0)
    });
  }
  return out;
}

export function primarySource(sources: CandidateSource[]): CandidateSource {
  return sources[0] ?? "fresh";
}

export function mergeCandidate(existing: FeedCandidate | undefined, incoming: FeedCandidate): FeedCandidate {
  if (!existing) return incoming;
  const sources = [...existing.sources];
  for (const s of incoming.sources) {
    if (!sources.includes(s)) sources.push(s);
  }
  return { ...existing, sources };
}
