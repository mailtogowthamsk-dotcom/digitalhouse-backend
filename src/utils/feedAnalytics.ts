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

type PendingFeedEvent = {
  userId: number;
  postId: number | null;
  eventType: string;
  meta: Record<string, unknown> | null;
  createdAt: Date;
};

/** Cap memory if flush falls behind (shared-hosting / pool saturation). */
const MAX_PENDING = Math.max(200, Number(process.env.FEED_EVENTS_MAX_PENDING || 2000));
const FLUSH_SIZE = Math.max(10, Number(process.env.FEED_EVENTS_FLUSH_SIZE || 50));
const FLUSH_MS = Math.max(100, Number(process.env.FEED_EVENTS_FLUSH_MS || 750));

const pending: PendingFeedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function warn(err: unknown, context: string): void {
  if (process.env.NODE_ENV === "production") return;
  console.warn("[feedAnalytics]", context, err instanceof Error ? err.message : err);
}

function scheduleFlush(immediate = false): void {
  if (immediate || pending.length >= FLUSH_SIZE) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    void flushNow();
    return;
  }
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushNow();
  }, FLUSH_MS);
}

async function flushNow(): Promise<void> {
  if (flushing) return;
  if (pending.length === 0) return;
  flushing = true;
  const batch = pending.splice(0, FLUSH_SIZE);
  try {
    // One round-trip / one pool checkout for many events — avoids N× remote INSERT waits.
    await FeedEngagementEvent.bulkCreate(batch as any[], {
      validate: false,
      // Don't inflate [slow-query] with analytics RTT under shared hosting.
      logging: false
    });
  } catch (err) {
    warn(err, `bulkCreate n=${batch.length}`);
  } finally {
    flushing = false;
    if (pending.length > 0) scheduleFlush(pending.length >= FLUSH_SIZE);
  }
}

function enqueue(row: PendingFeedEvent): void {
  if (pending.length >= MAX_PENDING) {
    // Drop oldest — analytics is best-effort under pressure.
    pending.splice(0, pending.length - MAX_PENDING + 1);
    warn(new Error("queue overflow"), "drop-oldest");
  }
  pending.push(row);
  scheduleFlush();
}

/** Fire-and-forget engagement logging for funnel analytics. */
export function logFeedEvent(
  userId: number,
  eventType: FeedEventType | string,
  postId?: number | null,
  meta?: Record<string, unknown>
): void {
  enqueue({
    userId,
    postId: postId ?? null,
    eventType: String(eventType).slice(0, 40),
    meta: meta ?? null,
    createdAt: new Date()
  });
}

/** Batch enqueue (e.g. POST /posts/events { events: [...] }). */
export function logFeedEvents(
  items: Array<{
    userId: number;
    eventType: FeedEventType | string;
    postId?: number | null;
    meta?: Record<string, unknown>;
  }>
): void {
  if (!items.length) return;
  const now = new Date();
  for (const item of items) {
    enqueue({
      userId: item.userId,
      postId: item.postId ?? null,
      eventType: String(item.eventType).slice(0, 40),
      meta: item.meta ?? null,
      createdAt: now
    });
  }
}

/** Test / shutdown helper — wait for pending rows to flush. */
export async function flushFeedEventsForTests(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  while (pending.length > 0 || flushing) {
    await flushNow();
    if (flushing) await new Promise((r) => setTimeout(r, 20));
  }
}
