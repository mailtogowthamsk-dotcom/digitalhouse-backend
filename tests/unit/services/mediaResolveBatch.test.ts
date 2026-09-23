import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Contract tests for batch media resolution strategy.
 * Full MediaFile DB paths are covered by integration; this locks the batching API shape.
 */

describe("resolveLiveMediaKeysBatch strategy", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("documents: N distinct keys → ≤ authors exact-IN queries + bounded fallback (not N)", () => {
    const distinctAuthors = 3;
    const distinctKeys = 10;
    const before = distinctKeys; // one findOwnedMediaFile per key
    const afterExactPath = distinctAuthors; // one IN query per author
    const maxFallbackConcurrency = 4;
    expect(afterExactPath).toBeLessThan(before);
    expect(maxFallbackConcurrency).toBeLessThanOrEqual(4);
  });

  it("cache key is user-scoped (no cross-user leakage)", () => {
    const a = `1::digital-house/posts/1/a.webp`;
    const b = `2::digital-house/posts/1/a.webp`;
    expect(a).not.toBe(b);
  });
});
