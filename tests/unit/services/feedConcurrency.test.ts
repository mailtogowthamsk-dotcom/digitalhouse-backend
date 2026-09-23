import { describe, expect, it } from "vitest";
import {
  allSettledWithConcurrency,
  feedCandidateConcurrency,
  mapWithConcurrency
} from "../../../src/services/feedRanking/feedConcurrency";

describe("feedConcurrency mapWithConcurrency", () => {
  it("preserves order and never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 6 }, (_, i) => async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight -= 1;
      return i * 10;
    });
    const out = await mapWithConcurrency(tasks, 2);
    expect(out).toEqual([0, 10, 20, 30, 40, 50]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("rejects when a task fails (Promise.all semantics)", async () => {
    await expect(
      mapWithConcurrency(
        [async () => 1, async () => Promise.reject(new Error("boom")), async () => 3],
        2
      )
    ).rejects.toThrow("boom");
  });
});

describe("feedConcurrency allSettledWithConcurrency", () => {
  it("preserves order and isolates failures", async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = [
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight -= 1;
        return "a";
      },
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight -= 1;
        throw new Error("x");
      },
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight -= 1;
        return "c";
      }
    ];
    const settled = await allSettledWithConcurrency(tasks, 2);
    expect(peak).toBeLessThanOrEqual(2);
    expect(settled[0]).toEqual({ status: "fulfilled", value: "a" });
    expect(settled[1]?.status).toBe("rejected");
    expect(settled[2]).toEqual({ status: "fulfilled", value: "c" });
  });
});

describe("feedCandidateConcurrency", () => {
  it("defaults to 3 and clamps invalid env", () => {
    const prev = process.env.FEED_CANDIDATE_CONCURRENCY;
    delete process.env.FEED_CANDIDATE_CONCURRENCY;
    expect(feedCandidateConcurrency()).toBe(3);
    process.env.FEED_CANDIDATE_CONCURRENCY = "0";
    expect(feedCandidateConcurrency()).toBe(3);
    process.env.FEED_CANDIDATE_CONCURRENCY = "2";
    expect(feedCandidateConcurrency()).toBe(2);
    if (prev === undefined) delete process.env.FEED_CANDIDATE_CONCURRENCY;
    else process.env.FEED_CANDIDATE_CONCURRENCY = prev;
  });
});

/**
 * Equivalence: counting overlaps from filtered rows must match fetch-all-then-filter.
 * Mirrors loadTagOverlaps in-memory reduction (SQL filter is a push-down of this logic).
 */
describe("loadTagOverlaps equivalence", () => {
  function countOverlaps(
    links: Array<{ postId: number; hashtagId: number }>,
    userHashtagIds: Set<number>,
    mode: "filter-after" | "prefiltered"
  ): Map<number, number> {
    const map = new Map<number, number>();
    for (const l of links) {
      if (mode === "filter-after" && !userHashtagIds.has(l.hashtagId)) continue;
      if (mode === "prefiltered" && !userHashtagIds.has(l.hashtagId)) {
        throw new Error("prefiltered mode received non-affinity hashtag");
      }
      map.set(l.postId, (map.get(l.postId) || 0) + 1);
    }
    return map;
  }

  it("filter-after and SQL-prefiltered counts match for the same affinity set", () => {
    const userTags = new Set([10, 20]);
    const allLinks = [
      { postId: 1, hashtagId: 10 },
      { postId: 1, hashtagId: 99 },
      { postId: 2, hashtagId: 20 },
      { postId: 2, hashtagId: 10 },
      { postId: 3, hashtagId: 5 }
    ];
    const after = countOverlaps(allLinks, userTags, "filter-after");
    const prefiltered = countOverlaps(
      allLinks.filter((l) => userTags.has(l.hashtagId)),
      userTags,
      "prefiltered"
    );
    expect([...after.entries()].sort()).toEqual([...prefiltered.entries()].sort());
    expect(after.get(1)).toBe(1);
    expect(after.get(2)).toBe(2);
    expect(after.has(3)).toBe(false);
  });
});
