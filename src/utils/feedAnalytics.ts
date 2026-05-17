import { FeedEngagementEvent } from "../models";

export type FeedEventType =
  | "feed_view"
  | "post_impression"
  | "post_open"
  | "like"
  | "unlike"
  | "comment"
  | "save"
  | "unsave"
  | "share"
  | "comment_sheet_open";

/** Fire-and-forget engagement logging for funnel analytics. */
export function logFeedEvent(
  userId: number,
  eventType: FeedEventType,
  postId?: number | null,
  meta?: Record<string, unknown>
): void {
  FeedEngagementEvent.create({
    userId,
    postId: postId ?? null,
    eventType,
    meta: meta ?? null
  } as any).catch((err) => {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[feedAnalytics]", eventType, err?.message);
    }
  });
}
