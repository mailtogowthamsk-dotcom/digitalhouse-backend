/**
 * P4A — request-scoped feed engagement hydration (1 DB round-trip).
 *
 * Operates only on already-authorized feed `postIds` (privacy/ranking happen upstream).
 * Preserves legacy semantics:
 * - likedByMe / savedByMe from post_likes / saved_posts for current user
 * - helpHelperCount = ACTIVE help_offers only (WITHDRAWN excluded)
 * - jobApplicationStatus / jobInterestedByMe from job_interests for current user (any status)
 * - jobApplicationCount = all job_interests rows per job post (no status filter)
 */

import { QueryTypes } from "sequelize";
import { sequelize } from "../../config/db";
import {
  buildFeedEngagementSql,
  emptyFeedEngagement,
  mapFeedEngagementRows,
  normalizeFeedPostIds,
  type FeedEngagementHydration,
  type FeedEngagementRow
} from "./feedEngagementBatch";

export type { FeedEngagementHydration, FeedEngagementRow } from "./feedEngagementBatch";
export {
  buildFeedEngagementSql,
  emptyFeedEngagement,
  mapFeedEngagementRows,
  normalizeFeedPostIds
} from "./feedEngagementBatch";

/**
 * One SQL round-trip for likes/saves/help (+ jobs when jobPostIds non-empty).
 */
export async function hydrateFeedEngagement(input: {
  userId: number;
  postIds: number[];
  jobPostIds: number[];
}): Promise<FeedEngagementHydration> {
  const started = Date.now();
  const postIds = normalizeFeedPostIds(input.postIds);
  if (postIds.length === 0) {
    return emptyFeedEngagement(Date.now() - started);
  }

  const jobPostIds = normalizeFeedPostIds(input.jobPostIds).filter((id) =>
    postIds.includes(id)
  );
  // Only query job tables for JOB ids that are on this authorized page.
  const includeJobs = jobPostIds.length > 0;
  const sql = buildFeedEngagementSql({ includeJobs });

  const replacements: Record<string, number | number[]> = {
    userId: input.userId,
    postIds
  };
  if (includeJobs) {
    replacements.jobPostIds = jobPostIds;
  }

  const rows = (await sequelize.query(sql, {
    replacements,
    type: QueryTypes.SELECT
  })) as FeedEngagementRow[];

  const mapped = mapFeedEngagementRows(rows);
  const durationMs = Date.now() - started;
  const result: FeedEngagementHydration = {
    ...mapped,
    queryCount: 1,
    durationMs
  };

  if (process.env.FEED_METRICS === "1") {
    console.info(
      "[feed-engagement]",
      JSON.stringify({
        postCount: postIds.length,
        jobPostCount: jobPostIds.length,
        queryCount: result.queryCount,
        durationMs: result.durationMs,
        includeJobs
      })
    );
  }

  return result;
}
