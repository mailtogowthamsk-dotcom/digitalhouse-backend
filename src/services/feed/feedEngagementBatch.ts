/**
 * Pure helpers for P4A feed engagement batching (no DB imports).
 */

export type FeedEngagementHydration = {
  likedSet: Set<number>;
  savedSet: Set<number>;
  /** ACTIVE help offer counts keyed by post id */
  helpHelperMap: Record<number, number>;
  jobInterestStatusByPost: Map<number, string>;
  jobApplicationCountByPost: Record<number, number>;
  /** Always 0 or 1 for this module (empty page skips SQL). */
  queryCount: number;
  durationMs: number;
};

export type FeedEngagementRow = {
  kind: string;
  postId: number | string;
  statusVal: string | null;
  cnt: number | string;
};

export function emptyFeedEngagement(durationMs = 0): FeedEngagementHydration {
  return {
    likedSet: new Set(),
    savedSet: new Set(),
    helpHelperMap: {},
    jobInterestStatusByPost: new Map(),
    jobApplicationCountByPost: {},
    queryCount: 0,
    durationMs
  };
}

/** Normalize IDs: unique positive integers only (avoids IN () and duplicate inflation). */
export function normalizeFeedPostIds(ids: number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of ids) {
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Pure mapper — unit-tested without DB.
 * Equivalent to the previous in-memory Set/Map construction from 5 findAll results.
 */
export function mapFeedEngagementRows(rows: FeedEngagementRow[]): Omit<
  FeedEngagementHydration,
  "queryCount" | "durationMs"
> {
  const likedSet = new Set<number>();
  const savedSet = new Set<number>();
  const helpHelperMap: Record<number, number> = {};
  const jobInterestStatusByPost = new Map<number, string>();
  const jobApplicationCountByPost: Record<number, number> = {};

  for (const row of rows) {
    const postId = Number(row.postId);
    if (!Number.isFinite(postId) || postId <= 0) continue;
    const cnt = Number(row.cnt);
    const kind = String(row.kind ?? "");

    if (kind === "like") {
      likedSet.add(postId);
    } else if (kind === "save") {
      savedSet.add(postId);
    } else if (kind === "help_count") {
      helpHelperMap[postId] = Number.isFinite(cnt) ? cnt : 0;
    } else if (kind === "my_job") {
      const status = row.statusVal != null ? String(row.statusVal).trim() : "";
      if (status) jobInterestStatusByPost.set(postId, status);
    } else if (kind === "job_count") {
      jobApplicationCountByPost[postId] = Number.isFinite(cnt) ? cnt : 0;
    }
  }

  return {
    likedSet,
    savedSet,
    helpHelperMap,
    jobInterestStatusByPost,
    jobApplicationCountByPost
  };
}

/**
 * Build the UNION ALL SQL for MySQL. Column names match live schema (camelCase).
 * Exported for tests — do not execute with empty postIds.
 */
export function buildFeedEngagementSql(opts: { includeJobs: boolean }): string {
  // Explicit charset/collation on string columns — avoids MySQL
  // "Illegal mix of collations for operation 'UNION'" (ENUM status vs CAST(NULL AS CHAR)).
  const nullStatus =
    "CAST('' AS CHAR(32) CHARSET utf8mb4) COLLATE utf8mb4_0900_ai_ci";
  const statusCol =
    "CAST(`status` AS CHAR(32) CHARSET utf8mb4) COLLATE utf8mb4_0900_ai_ci";

  const base = `
SELECT 'like' AS kind, \`postId\` AS postId, ${nullStatus} AS statusVal, 1 AS cnt
FROM \`post_likes\`
WHERE \`userId\` = :userId AND \`postId\` IN (:postIds)

UNION ALL

SELECT 'save' AS kind, \`postId\` AS postId, ${nullStatus} AS statusVal, 1 AS cnt
FROM \`saved_posts\`
WHERE \`userId\` = :userId AND \`postId\` IN (:postIds)

UNION ALL

SELECT 'help_count' AS kind, \`postId\` AS postId, ${nullStatus} AS statusVal, COUNT(*) AS cnt
FROM \`help_offers\`
WHERE \`status\` = 'ACTIVE' AND \`postId\` IN (:postIds)
GROUP BY \`postId\`
`.trim();

  if (!opts.includeJobs) return base;

  return `${base}

UNION ALL

SELECT 'my_job' AS kind, \`postId\` AS postId, ${statusCol} AS statusVal, 1 AS cnt
FROM \`job_interests\`
WHERE \`fromUserId\` = :userId AND \`postId\` IN (:jobPostIds)

UNION ALL

SELECT 'job_count' AS kind, \`postId\` AS postId, ${nullStatus} AS statusVal, COUNT(*) AS cnt
FROM \`job_interests\`
WHERE \`postId\` IN (:jobPostIds)
GROUP BY \`postId\`
`.trim();
}
