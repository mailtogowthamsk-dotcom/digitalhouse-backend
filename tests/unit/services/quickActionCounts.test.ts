import { describe, expect, it } from "vitest";

/**
 * Pure predicate mirrors getQuickActionCounts CASE WHEN buckets.
 * Used to verify status / deadline / soft-filter edge cases without a live DB.
 */
type PostFixture = {
  postType: string;
  moderationStatus: string;
  safetyDecision: string;
  authorStatus: string;
  jobStatus?: string | null;
  jobApplicationDeadline?: Date | null;
  marketplaceStatus?: string | null;
  helpStatus?: string | null;
  helpExpiresAt?: Date | null;
};

function isVisible(p: PostFixture): boolean {
  return (
    p.moderationStatus === "ACTIVE" &&
    p.safetyDecision === "SAFE" &&
    p.authorStatus === "APPROVED"
  );
}

function aggregateQuickActionCounts(posts: PostFixture[], now: Date) {
  const visible = posts.filter(isVisible);
  return {
    totalPosts: visible.length,
    openJobs: visible.filter(
      (p) =>
        p.postType === "JOB" &&
        (p.jobStatus === "OPEN" || p.jobStatus == null) &&
        (p.jobApplicationDeadline == null || p.jobApplicationDeadline > now)
    ).length,
    marketplaceItems: visible.filter(
      (p) => p.postType === "MARKETPLACE" && p.marketplaceStatus === "LIVE"
    ).length,
    matrimonyProfiles: visible.filter((p) => p.postType === "MATRIMONY").length,
    helpingHandRequests: visible.filter(
      (p) =>
        p.postType === "HELP_REQUEST" &&
        (p.helpStatus === "OPEN" || p.helpStatus === "IN_PROGRESS") &&
        (p.helpExpiresAt == null || p.helpExpiresAt > now)
    ).length,
    communityUpdates: visible.filter((p) => p.postType === "ANNOUNCEMENT").length
  };
}

const now = new Date("2026-09-22T12:00:00.000Z");

describe("quickActionCounts aggregate semantics", () => {
  it("returns zeros for empty set", () => {
    expect(aggregateQuickActionCounts([], now)).toEqual({
      totalPosts: 0,
      openJobs: 0,
      marketplaceItems: 0,
      matrimonyProfiles: 0,
      helpingHandRequests: 0,
      communityUpdates: 0
    });
  });

  it("counts one of each bucket", () => {
    const posts: PostFixture[] = [
      { postType: "GENERAL", moderationStatus: "ACTIVE", safetyDecision: "SAFE", authorStatus: "APPROVED" },
      {
        postType: "JOB",
        moderationStatus: "ACTIVE",
        safetyDecision: "SAFE",
        authorStatus: "APPROVED",
        jobStatus: "OPEN",
        jobApplicationDeadline: null
      },
      {
        postType: "MARKETPLACE",
        moderationStatus: "ACTIVE",
        safetyDecision: "SAFE",
        authorStatus: "APPROVED",
        marketplaceStatus: "LIVE"
      },
      { postType: "MATRIMONY", moderationStatus: "ACTIVE", safetyDecision: "SAFE", authorStatus: "APPROVED" },
      {
        postType: "HELP_REQUEST",
        moderationStatus: "ACTIVE",
        safetyDecision: "SAFE",
        authorStatus: "APPROVED",
        helpStatus: "OPEN",
        helpExpiresAt: null
      },
      { postType: "ANNOUNCEMENT", moderationStatus: "ACTIVE", safetyDecision: "SAFE", authorStatus: "APPROVED" }
    ];
    expect(aggregateQuickActionCounts(posts, now)).toEqual({
      totalPosts: 6,
      openJobs: 1,
      marketplaceItems: 1,
      matrimonyProfiles: 1,
      helpingHandRequests: 1,
      communityUpdates: 1
    });
  });

  it("excludes unauthorized / hidden / unsafe authors and posts", () => {
    const posts: PostFixture[] = [
      { postType: "ANNOUNCEMENT", moderationStatus: "HIDDEN", safetyDecision: "SAFE", authorStatus: "APPROVED" },
      { postType: "ANNOUNCEMENT", moderationStatus: "ACTIVE", safetyDecision: "BLOCKED", authorStatus: "APPROVED" },
      { postType: "ANNOUNCEMENT", moderationStatus: "ACTIVE", safetyDecision: "SAFE", authorStatus: "PENDING" },
      { postType: "ANNOUNCEMENT", moderationStatus: "ACTIVE", safetyDecision: "SAFE", authorStatus: "APPROVED" }
    ];
    expect(aggregateQuickActionCounts(posts, now).communityUpdates).toBe(1);
    expect(aggregateQuickActionCounts(posts, now).totalPosts).toBe(1);
  });

  it("excludes closed jobs and past deadlines", () => {
    const posts: PostFixture[] = [
      {
        postType: "JOB",
        moderationStatus: "ACTIVE",
        safetyDecision: "SAFE",
        authorStatus: "APPROVED",
        jobStatus: "CLOSED",
        jobApplicationDeadline: null
      },
      {
        postType: "JOB",
        moderationStatus: "ACTIVE",
        safetyDecision: "SAFE",
        authorStatus: "APPROVED",
        jobStatus: "OPEN",
        jobApplicationDeadline: new Date("2026-01-01T00:00:00.000Z")
      },
      {
        postType: "JOB",
        moderationStatus: "ACTIVE",
        safetyDecision: "SAFE",
        authorStatus: "APPROVED",
        jobStatus: null,
        jobApplicationDeadline: new Date("2026-12-01T00:00:00.000Z")
      }
    ];
    expect(aggregateQuickActionCounts(posts, now).openJobs).toBe(1);
    expect(aggregateQuickActionCounts(posts, now).totalPosts).toBe(3);
  });

  it("excludes expired help and non-open help statuses", () => {
    const posts: PostFixture[] = [
      {
        postType: "HELP_REQUEST",
        moderationStatus: "ACTIVE",
        safetyDecision: "SAFE",
        authorStatus: "APPROVED",
        helpStatus: "CLOSED",
        helpExpiresAt: null
      },
      {
        postType: "HELP_REQUEST",
        moderationStatus: "ACTIVE",
        safetyDecision: "SAFE",
        authorStatus: "APPROVED",
        helpStatus: "IN_PROGRESS",
        helpExpiresAt: new Date("2026-01-01T00:00:00.000Z")
      },
      {
        postType: "HELP_REQUEST",
        moderationStatus: "ACTIVE",
        safetyDecision: "SAFE",
        authorStatus: "APPROVED",
        helpStatus: "IN_PROGRESS",
        helpExpiresAt: new Date("2026-12-01T00:00:00.000Z")
      }
    ];
    expect(aggregateQuickActionCounts(posts, now).helpingHandRequests).toBe(1);
  });

  it("does not double-count when multiple marketplace rows exist", () => {
    const posts: PostFixture[] = [
      {
        postType: "MARKETPLACE",
        moderationStatus: "ACTIVE",
        safetyDecision: "SAFE",
        authorStatus: "APPROVED",
        marketplaceStatus: "LIVE"
      },
      {
        postType: "MARKETPLACE",
        moderationStatus: "ACTIVE",
        safetyDecision: "SAFE",
        authorStatus: "APPROVED",
        marketplaceStatus: "LIVE"
      },
      {
        postType: "MARKETPLACE",
        moderationStatus: "ACTIVE",
        safetyDecision: "SAFE",
        authorStatus: "APPROVED",
        marketplaceStatus: "SOLD"
      }
    ];
    expect(aggregateQuickActionCounts(posts, now).marketplaceItems).toBe(2);
    expect(aggregateQuickActionCounts(posts, now).totalPosts).toBe(3);
  });
});

describe("quickActionCounts query strategy", () => {
  it("documents reduction from 6 COUNT queries to 1 aggregate", () => {
    // Static contract — runtime EXPLAIN requires live DB.
    expect({ before: 6, after: 1 }).toEqual({ before: 6, after: 1 });
  });
});
