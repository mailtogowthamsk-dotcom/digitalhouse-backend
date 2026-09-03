import type { DecodedFeedCursor } from "./types";
import { isAfterCursor } from "./math";

export type FeedPagePhase = "ranked" | "tail";

export type RankedKey = { finalScore: number; createdAt: Date; postId: number };

/**
 * Ranked posts first; when that list is exhausted, continue in chronological
 * order so eligible posts are never dropped just because they missed the candidate cap.
 */
export function planFeedPage<T extends RankedKey>(
  ranked: T[],
  cursor: DecodedFeedCursor | null,
  limit: number
): {
  phase: FeedPagePhase;
  rankedSlice: T[];
  rankedHasMore: boolean;
  needTail: boolean;
  tailAfter: { createdAt: Date; postId: number } | null;
} {
  if (cursor?.phase === "tail") {
    return {
      phase: "tail",
      rankedSlice: [],
      rankedHasMore: false,
      needTail: true,
      tailAfter:
        cursor.postId > 0 && cursor.tieBreaker > 0
          ? { createdAt: new Date(cursor.tieBreaker), postId: cursor.postId }
          : null
    };
  }

  const after = cursor
    ? ranked.filter((c) =>
        isAfterCursor(c, {
          score: cursor.score,
          tieBreaker: cursor.tieBreaker,
          postId: cursor.postId
        })
      )
    : ranked;
  const rankedSlice = after.slice(0, limit);
  const rankedHasMore = after.length > limit;
  return {
    phase: "ranked",
    rankedSlice,
    rankedHasMore,
    needTail: !rankedHasMore,
    tailAfter: null
  };
}
