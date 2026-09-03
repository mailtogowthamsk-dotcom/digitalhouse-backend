import { describe, expect, it } from "vitest";
import { FEED_RANKING_CONFIG as CFG } from "../../../src/services/feedRanking/config";
import {
  applyExposureToScore,
  applySoftDiversity,
  capContribution,
  coldStartTier,
  compareRanked,
  engagementSignal,
  exposurePenaltySignal,
  freshnessSignal,
  interestSignal,
  isAfterCursor,
  personalizationScales,
  scoreStage1
} from "../../../src/services/feedRanking/math";
import { decodeFeedCursor, encodeFeedCursor, makeSessionContext } from "../../../src/services/feedRanking/cursor";
import { isPersonalizedHomeRequest } from "../../../src/services/feedRanking/requestGate";
import { scoreHomeFeedCandidate } from "../../../src/services/feedRanking/signals";
import { planFeedPage } from "../../../src/services/feedRanking/pagination";
import { encodeTailStartCursor } from "../../../src/services/feedRanking/cursor";
import type { FeedCandidate, ScoredCandidate } from "../../../src/services/feedRanking/types";

const now = new Date("2026-08-19T12:00:00.000Z");

function candidate(partial: Partial<FeedCandidate> & Pick<FeedCandidate, "postId">): FeedCandidate {
  return {
    authorId: 2,
    createdAt: now,
    likeCount: 0,
    commentCount: 0,
    postType: "ANNOUNCEMENT",
    sources: ["fresh"],
    ...partial
  };
}

function scored(partial: Partial<ScoredCandidate> & Pick<ScoredCandidate, "postId" | "finalScore">): ScoredCandidate {
  const base = candidate({ postId: partial.postId, authorId: partial.authorId, postType: partial.postType });
  return {
    ...base,
    interest: 0,
    connection: 0,
    freshness: 1,
    engagement: 0,
    quality: 0,
    interestContribution: 0,
    connectionContribution: 0,
    freshnessContribution: 0,
    engagementContribution: 0,
    qualityContribution: 0,
    exposurePenalty: 0,
    diversityPenalty: 0,
    stage1Score: partial.finalScore,
    ...partial
  };
}

describe("feed ranking math", () => {
  it("treats source budgets as caps in config (not fill-quotas)", () => {
    expect(CFG.sourceMax.connection).toBe(40);
    expect(CFG.stage1Max).toBeLessThanOrEqual(200);
  });

  it("caps contributions so raw engagement cannot dominate", () => {
    expect(capContribution(10_000, CFG.caps.engagement)).toBe(CFG.caps.engagement);
    const fresh = freshnessSignal(now, now);
    const viralOld = engagementSignal(10_000, 5_000, 0.05);
    const modestNew = engagementSignal(4, 1, 1);
    expect(viralOld).toBeLessThan(modestNew);
    expect(fresh).toBe(1);
  });

  it("decays freshness continuously rather than as a boolean", () => {
    const recent = freshnessSignal(new Date(now.getTime() - 2 * 3600_000), now);
    const older = freshnessSignal(new Date(now.getTime() - 72 * 3600_000), now);
    expect(recent).toBeGreaterThan(older);
    expect(recent).toBeGreaterThan(0.5);
    expect(older).toBeGreaterThan(0);
    expect(older).toBeLessThan(0.3);
  });

  it("does not strongly personalize a single like (cold start)", () => {
    expect(coldStartTier({ connectionCount: 0, likeCount: 1, commentCount: 0, hashtagCount: 1 })).toBe("none");
    expect(coldStartTier({ connectionCount: 1, likeCount: 2, commentCount: 0, hashtagCount: 0 })).toBe("limited");
    expect(
      coldStartTier({ connectionCount: 3, likeCount: 8, commentCount: 4, hashtagCount: 5 })
    ).toBe("full");
    expect(personalizationScales("none").interest).toBe(0);
    expect(personalizationScales("limited").interest).toBeLessThan(1);
    expect(personalizationScales("full").interest).toBe(1);
  });

  it("applies a time-decayed exposure penalty without excluding the post", () => {
    const recent = exposurePenaltySignal(
      { postId: 1, impressionCount: 1, lastSeenAt: new Date(now.getTime() - 60 * 60_000) },
      now
    );
    const weekAgo = exposurePenaltySignal(
      { postId: 1, impressionCount: 3, lastSeenAt: new Date(now.getTime() - 10 * 24 * 3600_000) },
      now
    );
    expect(recent).toBeGreaterThan(0.6);
    expect(weekAgo).toBe(0);
    const after = applyExposureToScore(90, recent);
    expect(after).toBeLessThan(90);
    expect(after).toBeGreaterThan(0);
  });

  it("keeps a highly relevant same-author post ahead of a weak one (soft diversity)", () => {
    const ranked = applySoftDiversity([
      scored({ postId: 1, authorId: 9, finalScore: 90 }),
      scored({ postId: 2, authorId: 9, finalScore: 88 }),
      scored({ postId: 3, authorId: 4, finalScore: 20 })
    ]);
    ranked.sort(compareRanked);
    expect(ranked[0]?.postId).toBe(1);
    expect(ranked.map((r) => r.postId)).toContain(2);
  });

  it("uses keyset ordering after a cursor", () => {
    const cursor = { score: 50, tieBreaker: now.getTime(), postId: 10 };
    expect(isAfterCursor({ finalScore: 40, createdAt: now, postId: 9 }, cursor)).toBe(true);
    expect(isAfterCursor({ finalScore: 60, createdAt: now, postId: 11 }, cursor)).toBe(false);
    expect(isAfterCursor({ finalScore: 50, createdAt: now, postId: 9 }, cursor)).toBe(true);
  });

  it("scores missing interest as zero, not an error", () => {
    expect(interestSignal(0, 0)).toBe(0);
    const s = scoreStage1(candidate({ postId: 3 }), 1, now, new Set(), 0, 0, {
      interest: 1,
      connection: 1
    });
    expect(s.interestContribution).toBe(0);
    expect(s.stage1Score).toBeGreaterThan(0);
  });
});

describe("feed cursor session", () => {
  it("round-trips an opaque cursor without exposing userId", () => {
    const session = makeSessionContext();
    const token = encodeFeedCursor({
      session,
      score: 41.25,
      createdAt: now,
      postId: 99
    });
    expect(token).not.toContain("userId");
    const decoded = decodeFeedCursor(token);
    expect(decoded?.sessionId).toBe(session.sessionId);
    expect(decoded?.postId).toBe(99);
    expect(decoded?.score).toBeCloseTo(41.25, 3);
    expect(decoded?.seed).toBe(session.seed);
    expect(decoded?.phase).toBe("ranked");
  });

  it("rejects a tampered cursor", () => {
    const session = makeSessionContext();
    const token = encodeFeedCursor({ session, score: 1, createdAt: now, postId: 1 });
    expect(decodeFeedCursor(token.slice(0, -2) + "ab")).toBeNull();
    expect(decodeFeedCursor("12345")).toBeNull();
  });

  it("reuses the same session seed across pages", () => {
    const session = makeSessionContext("aaaaaaaaaaaaaaaa");
    const c1 = encodeFeedCursor({ session, score: 10, createdAt: now, postId: 1 });
    const c2 = encodeFeedCursor({ session, score: 8, createdAt: now, postId: 2 });
    expect(decodeFeedCursor(c1)?.seed).toBe(decodeFeedCursor(c2)?.seed);
  });
});

describe("feed pagination completeness", () => {
  const ranked = [
    scored({ postId: 1, finalScore: 90, createdAt: now }),
    scored({ postId: 2, finalScore: 80, createdAt: now }),
    scored({ postId: 3, finalScore: 70, createdAt: now })
  ];

  it("keeps serving after the ranked cap via a tail phase", () => {
    const session = makeSessionContext("bbbbbbbbbbbbbbbb");
    const first = planFeedPage(ranked, null, 2);
    expect(first.rankedSlice.map((r) => r.postId)).toEqual([1, 2]);
    expect(first.rankedHasMore).toBe(true);
    expect(first.needTail).toBe(false);

    const cursor = encodeFeedCursor({
      session,
      score: first.rankedSlice[1]!.finalScore,
      createdAt: first.rankedSlice[1]!.createdAt,
      postId: 2,
      phase: "ranked"
    });
    const second = planFeedPage(ranked, decodeFeedCursor(cursor), 2);
    expect(second.rankedSlice.map((r) => r.postId)).toEqual([3]);
    expect(second.rankedHasMore).toBe(false);
    expect(second.needTail).toBe(true);

    const tailStart = encodeTailStartCursor(session);
    const tail = planFeedPage(ranked, decodeFeedCursor(tailStart), 2);
    expect(tail.phase).toBe("tail");
    expect(tail.rankedSlice).toEqual([]);
    expect(tail.needTail).toBe(true);
  });
});

describe("personalized feed request gating", () => {
  it("does not personalize jobs, marketplace, help, mine, saved, or popular", () => {
    const base = { limit: 6, sort: "recent" as const };
    expect(isPersonalizedHomeRequest(base)).toBe(true);
    expect(isPersonalizedHomeRequest({ ...base, postType: "JOB" })).toBe(false);
    expect(isPersonalizedHomeRequest({ ...base, postType: "MARKETPLACE" })).toBe(false);
    expect(isPersonalizedHomeRequest({ ...base, postType: "HELP_REQUEST" })).toBe(false);
    expect(isPersonalizedHomeRequest({ ...base, mine: true })).toBe(false);
    expect(isPersonalizedHomeRequest({ ...base, saved: true })).toBe(false);
    expect(isPersonalizedHomeRequest({ ...base, sort: "popular" })).toBe(false);
  });
});

describe("interest vs exposure vs engagement quality", () => {
  const scales = { interest: 1, connection: 1 };
  const emptyConnections = new Set<number>();

  function score(opts: {
    postId: number;
    tagOverlap: number;
    userTagCount: number;
    likeCount?: number;
    lastSeenAt?: Date;
    impressionCount?: number;
  }) {
    return scoreHomeFeedCandidate({
      candidate: candidate({
        postId: opts.postId,
        likeCount: opts.likeCount ?? 0,
        createdAt: now
      }),
      viewerId: 1,
      now,
      connectionIds: emptyConnections,
      tagOverlap: opts.tagOverlap,
      userTagCount: opts.userTagCount,
      scales,
      ...(opts.lastSeenAt
        ? {
            exposure: {
              postId: opts.postId,
              impressionCount: opts.impressionCount ?? 1,
              lastSeenAt: opts.lastSeenAt
            }
          }
        : {})
    });
  }

  it("keeps engagement quality cap below exposure cap so likes cannot cancel seen", () => {
    expect(CFG.caps.engagement).toBeLessThan(CFG.caps.exposure);
  });

  it("Test 1 — liked + recently seen does not outrank a similar unseen post", () => {
    const seenLiked = score({
      postId: 1,
      tagOverlap: 2,
      userTagCount: 3,
      lastSeenAt: new Date(now.getTime() - 30_000)
    });
    const unseen = score({
      postId: 2,
      tagOverlap: 2,
      userTagCount: 3
    });
    expect(seenLiked.exposurePenalty).toBeGreaterThan(0);
    expect(unseen.exposurePenalty).toBe(0);
    expect(seenLiked.finalScore).toBeLessThan(unseen.finalScore);
  });

  it("Test 2 — liked post seen days ago has a much smaller exposure penalty", () => {
    const recent = score({
      postId: 1,
      tagOverlap: 3,
      userTagCount: 3,
      lastSeenAt: new Date(now.getTime() - 30_000)
    });
    const old = score({
      postId: 1,
      tagOverlap: 3,
      userTagCount: 3,
      lastSeenAt: new Date(now.getTime() - 5 * 24 * 3600_000)
    });
    expect(old.exposurePenalty).toBeLessThan(recent.exposurePenalty * 0.5);
    expect(old.finalScore).toBeGreaterThan(recent.finalScore);
  });

  it("Test 3 — future similar post gets higher interest relevance", () => {
    const photography = score({ postId: 10, tagOverlap: 3, userTagCount: 3 });
    const unrelated = score({ postId: 11, tagOverlap: 0, userTagCount: 3 });
    expect(photography.interest).toBeGreaterThan(unrelated.interest);
    expect(photography.interestContribution).toBeGreaterThan(unrelated.interestContribution);
    expect(photography.finalScore).toBeGreaterThan(unrelated.finalScore);
  });

  it("Test 4 — high global engagement cannot cancel a recent exposure penalty", () => {
    const unseenViral = score({
      postId: 1,
      tagOverlap: 1,
      userTagCount: 3,
      likeCount: 50_000
    });
    const seenViral = score({
      postId: 1,
      tagOverlap: 1,
      userTagCount: 3,
      likeCount: 50_000,
      lastSeenAt: new Date(now.getTime() - 60_000)
    });
    expect(seenViral.engagementContribution).toBe(unseenViral.engagementContribution);
    expect(seenViral.engagementContribution).toBeLessThanOrEqual(CFG.caps.engagement);
    expect(seenViral.exposurePenalty).toBeGreaterThan(CFG.caps.engagement);
    expect(unseenViral.finalScore - seenViral.finalScore).toBeGreaterThanOrEqual(
      seenViral.exposurePenalty - 0.001
    );
  });

  it("Test 5 — no exposure history means zero exposure penalty", () => {
    const s = score({ postId: 7, tagOverlap: 2, userTagCount: 3 });
    expect(s.exposurePenalty).toBe(0);
  });

  it("Test 6 — like is not an impression; scoring ignores likedByMe", () => {
    const base = {
      candidate: candidate({ postId: 4, likeCount: 3 }),
      viewerId: 1,
      now,
      connectionIds: emptyConnections,
      tagOverlap: 2,
      userTagCount: 3,
      scales
    };
    const withoutLikeFlag = scoreHomeFeedCandidate(base);
    const withLikeFlag = scoreHomeFeedCandidate({
      ...base,
      ...({ likedByMe: true } as object)
    } as typeof base);
    expect(withoutLikeFlag.finalScore).toBe(withLikeFlag.finalScore);
    expect(withoutLikeFlag.exposurePenalty).toBe(0);
    expect(scoreHomeFeedCandidate.length).toBe(1);
  });
});
