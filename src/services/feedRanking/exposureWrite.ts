import { sequelize } from "../../config/db";
import { FeedPostExposure } from "../../models";
import type { ExposureRow } from "./types";

/**
 * Bulk upsert viewport impressions. Failure must never fail the Feed HTTP path.
 * Increments impressionCount and refreshes lastSeenAt.
 */
export async function recordFeedImpressions(userId: number, postIds: number[]): Promise<void> {
  const unique = [...new Set(postIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!userId || unique.length === 0) return;
  const now = new Date();
  const placeholders: string[] = [];
  const replacements: unknown[] = [];
  for (const postId of unique) {
    placeholders.push("(?, ?, 1, ?, ?, ?, ?)");
    replacements.push(userId, postId, now, now, now, now);
  }
  await sequelize.query(
    `INSERT INTO feed_post_exposures
      (userId, postId, impressionCount, firstSeenAt, lastSeenAt, createdAt, updatedAt)
     VALUES ${placeholders.join(",")}
     ON DUPLICATE KEY UPDATE
       impressionCount = impressionCount + 1,
       lastSeenAt = VALUES(lastSeenAt),
       updatedAt = VALUES(updatedAt)`,
    { replacements, logging: false }
  );
}

export async function loadExposuresForPosts(
  userId: number,
  postIds: number[]
): Promise<Map<number, ExposureRow>> {
  const unique = [...new Set(postIds.filter((id) => Number.isInteger(id) && id > 0))];
  const map = new Map<number, ExposureRow>();
  if (!userId || unique.length === 0) return map;
  try {
    const rows = await FeedPostExposure.findAll({
      where: { userId, postId: unique },
      attributes: ["postId", "impressionCount", "lastSeenAt"],
      raw: true
    });
    for (const r of rows as Array<{ postId: number; impressionCount: number; lastSeenAt: Date }>) {
      map.set(r.postId, {
        postId: r.postId,
        impressionCount: Number(r.impressionCount) || 0,
        lastSeenAt: r.lastSeenAt
      });
    }
  } catch {
    return map;
  }
  return map;
}
