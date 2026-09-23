import { describe, expect, it, vi, beforeEach } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("../../../src/config/db", () => ({
  sequelize: { query: queryMock }
}));

import {
  buildFeedEngagementSql,
  emptyFeedEngagement,
  mapFeedEngagementRows,
  normalizeFeedPostIds,
  type FeedEngagementRow
} from "../../../src/services/feed/feedEngagementBatch";
import { hydrateFeedEngagement } from "../../../src/services/feed/hydrateFeedEngagement";

describe("normalizeFeedPostIds", () => {
  it("Case 6/7 — empty and duplicate IDs", () => {
    expect(normalizeFeedPostIds([])).toEqual([]);
    expect(normalizeFeedPostIds([1, 1, 2, 0, -3, Number.NaN, 2])).toEqual([1, 2]);
  });
});

describe("mapFeedEngagementRows", () => {
  it("Case 2/3 — liked + saved and absent flags", () => {
    const rows: FeedEngagementRow[] = [
      { kind: "like", postId: 10, statusVal: null, cnt: 1 },
      { kind: "save", postId: 10, statusVal: null, cnt: 1 },
      { kind: "like", postId: 11, statusVal: null, cnt: 1 }
    ];
    const m = mapFeedEngagementRows(rows);
    expect(m.likedSet.has(10)).toBe(true);
    expect(m.savedSet.has(10)).toBe(true);
    expect(m.likedSet.has(11)).toBe(true);
    expect(m.savedSet.has(11)).toBe(false);
    expect(m.likedSet.has(99)).toBe(false);
  });

  it("Case 4 — help_count ACTIVE aggregates only (mapper trusts SQL filter)", () => {
    const rows: FeedEngagementRow[] = [
      { kind: "help_count", postId: 20, statusVal: null, cnt: 3 },
      { kind: "help_count", postId: 21, statusVal: null, cnt: "0" }
    ];
    const m = mapFeedEngagementRows(rows);
    expect(m.helpHelperMap[20]).toBe(3);
    expect(m.helpHelperMap[21]).toBe(0);
    expect(m.helpHelperMap[22]).toBeUndefined();
  });

  it("Case 5 — job status and application count stay separate", () => {
    const rows: FeedEngagementRow[] = [
      { kind: "my_job", postId: 5, statusVal: "APPLIED", cnt: 1 },
      { kind: "job_count", postId: 5, statusVal: null, cnt: 2 },
      { kind: "job_count", postId: 6, statusVal: null, cnt: 1 }
    ];
    const m = mapFeedEngagementRows(rows);
    expect(m.jobInterestStatusByPost.get(5)).toBe("APPLIED");
    expect(m.jobInterestStatusByPost.has(6)).toBe(false);
    expect(m.jobApplicationCountByPost[5]).toBe(2);
    expect(m.jobApplicationCountByPost[6]).toBe(1);
  });

  it("Case 1 — mixed feed kinds map without cross-talk", () => {
    const rows: FeedEngagementRow[] = [
      { kind: "like", postId: 1, statusVal: null, cnt: 1 },
      { kind: "save", postId: 2, statusVal: null, cnt: 1 },
      { kind: "help_count", postId: 3, statusVal: null, cnt: 4 },
      { kind: "my_job", postId: 4, statusVal: "SHORTLISTED", cnt: 1 },
      { kind: "job_count", postId: 4, statusVal: null, cnt: 7 },
      { kind: "unknown", postId: 99, statusVal: null, cnt: 9 }
    ];
    const m = mapFeedEngagementRows(rows);
    expect(m.likedSet.has(1)).toBe(true);
    expect(m.savedSet.has(2)).toBe(true);
    expect(m.helpHelperMap[3]).toBe(4);
    expect(m.jobInterestStatusByPost.get(4)).toBe("SHORTLISTED");
    expect(m.jobApplicationCountByPost[4]).toBe(7);
    expect(m.likedSet.has(99)).toBe(false);
    expect(m.jobApplicationCountByPost[99]).toBeUndefined();
  });

  it("ignores invalid post ids", () => {
    const m = mapFeedEngagementRows([
      { kind: "like", postId: "x" as unknown as number, statusVal: null, cnt: 1 },
      { kind: "like", postId: 0, statusVal: null, cnt: 1 }
    ]);
    expect(m.likedSet.size).toBe(0);
  });
});

describe("buildFeedEngagementSql", () => {
  it("always filters help to ACTIVE and scopes likes/saves to userId", () => {
    const sql = buildFeedEngagementSql({ includeJobs: false });
    expect(sql).toContain("`post_likes`");
    expect(sql).toContain("`saved_posts`");
    expect(sql).toContain("`help_offers`");
    expect(sql).toMatch(/status`\s*=\s*'ACTIVE'/);
    expect(sql).not.toContain("job_interests");
    expect(sql).toContain("IN (:postIds)");
  });

  it("includes my_job + job_count only when jobs requested", () => {
    const sql = buildFeedEngagementSql({ includeJobs: true });
    expect(sql).toContain("'my_job'");
    expect(sql).toContain("'job_count'");
    expect(sql).toContain("`job_interests`");
    expect(sql).toContain("IN (:jobPostIds)");
    expect(sql).toContain("`fromUserId` = :userId");
  });

  it("Case 8 — SQL only binds provided postIds (no expansion)", () => {
    const sql = buildFeedEngagementSql({ includeJobs: true });
    expect(sql).not.toMatch(/FROM\s+`?posts`?/i);
    expect(sql).not.toContain("visibility");
    expect(sql).not.toContain("community");
  });
});

describe("emptyFeedEngagement", () => {
  it("Case 6 — empty page returns empty structures and queryCount 0", () => {
    const e = emptyFeedEngagement(12);
    expect(e.queryCount).toBe(0);
    expect(e.durationMs).toBe(12);
    expect(e.likedSet.size).toBe(0);
    expect(e.savedSet.size).toBe(0);
    expect(Object.keys(e.helpHelperMap)).toEqual([]);
    expect(e.jobInterestStatusByPost.size).toBe(0);
    expect(Object.keys(e.jobApplicationCountByPost)).toEqual([]);
  });
});

describe("hydrateFeedEngagement (mocked sequelize)", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("Case 6 — empty postIds does not call sequelize.query", async () => {
    const result = await hydrateFeedEngagement({
      userId: 1,
      postIds: [],
      jobPostIds: [5]
    });
    expect(queryMock).not.toHaveBeenCalled();
    expect(result.queryCount).toBe(0);
  });

  it("runs exactly one query and maps rows (queryCount=1)", async () => {
    queryMock.mockResolvedValue([
      { kind: "like", postId: 10, statusVal: null, cnt: 1 },
      { kind: "help_count", postId: 20, statusVal: null, cnt: 2 },
      { kind: "my_job", postId: 5, statusVal: "APPLIED", cnt: 1 },
      { kind: "job_count", postId: 5, statusVal: null, cnt: 2 }
    ]);
    const result = await hydrateFeedEngagement({
      userId: 1,
      postIds: [10, 20, 5, 5],
      jobPostIds: [5]
    });
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(result.queryCount).toBe(1);
    expect(result.likedSet.has(10)).toBe(true);
    expect(result.helpHelperMap[20]).toBe(2);
    expect(result.jobInterestStatusByPost.get(5)).toBe("APPLIED");
    expect(result.jobApplicationCountByPost[5]).toBe(2);
    const replacements = queryMock.mock.calls[0]?.[1]?.replacements as {
      postIds: number[];
      jobPostIds: number[];
      userId: number;
    };
    expect(replacements.userId).toBe(1);
    expect(replacements.postIds).toEqual([10, 20, 5]);
    expect(replacements.jobPostIds).toEqual([5]);
  });

  it("omits job SQL when no job posts on the page", async () => {
    queryMock.mockResolvedValue([]);
    await hydrateFeedEngagement({
      userId: 1,
      postIds: [1, 2],
      jobPostIds: []
    });
    const sql = String(queryMock.mock.calls[0]?.[0] ?? "");
    expect(sql).not.toContain("job_interests");
    expect(queryMock.mock.calls[0]?.[1]?.replacements?.jobPostIds).toBeUndefined();
  });

  it("Case 8 — drops jobPostIds that are not in authorized postIds", async () => {
    queryMock.mockResolvedValue([]);
    await hydrateFeedEngagement({
      userId: 1,
      postIds: [10],
      jobPostIds: [999]
    });
    const sql = String(queryMock.mock.calls[0]?.[0] ?? "");
    expect(sql).not.toContain("job_interests");
  });
});
