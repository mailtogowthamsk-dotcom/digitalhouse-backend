import { FEED_RANKING_CONFIG as CFG } from "./config";
import {
  applyExposureToScore,
  capContribution,
  connectionSignal,
  engagementSignal,
  exposurePenaltySignal,
  freshnessSignal,
  interestSignal,
  scoreStage1
} from "./math";
import type { ExposureRow, FeedCandidate, ScoredCandidate } from "./types";

/**
 * Named ranking signals. Keep these separate:
 * Interest  = type/topic affinity (from OTHER posts the user liked/commented/saved)
 * Connection = relationship to author
 * Freshness = recency of the post
 * EngagementQuality = global popularity of the post (never viewer likedByMe)
 * Exposure = this user actually saw this post in Feed
 * Quality = reserved (v1 unused)
 *
 * Do not add likedByMe / savedByMe / viewerCommentOnThisPost to HomeFeedScoreInput.
 */
export const InterestSignal = interestSignal;
export const ConnectionSignal = connectionSignal;
export const FreshnessSignal = freshnessSignal;
export const EngagementQualitySignal = engagementSignal;
export const ExposureSignal = exposurePenaltySignal;
export const QualitySignal = (): number => 0;

/**
 * `likedByMe` / `savedByMe` are intentionally `never` so TypeScript rejects
 * using UI engagement flags as a re-display boost.
 */
export type HomeFeedScoreInput = {
  candidate: FeedCandidate;
  viewerId: number;
  now: Date;
  connectionIds: Set<number>;
  tagOverlap: number;
  userTagCount: number;
  scales: { interest: number; connection: number };
  exposure?: ExposureRow;
  likedByMe?: never;
  savedByMe?: never;
};

export function scoreHomeFeedCandidate(input: HomeFeedScoreInput): ScoredCandidate {
  const stage1 = scoreStage1(
    input.candidate,
    input.viewerId,
    input.now,
    input.connectionIds,
    input.tagOverlap,
    input.userTagCount,
    input.scales
  );
  const exposureUnit = ExposureSignal(input.exposure, input.now);
  return {
    ...input.candidate,
    ...stage1,
    exposurePenalty: capContribution(exposureUnit * CFG.caps.exposure, CFG.caps.exposure),
    diversityPenalty: 0,
    finalScore: applyExposureToScore(stage1.stage1Score, exposureUnit)
  };
}
