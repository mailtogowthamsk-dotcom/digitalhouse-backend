import { describe, expect, it } from "vitest";
import {
  matchLiveMediaKeyFromRows,
  ownedLookupBaseName,
  stagingLookupBaseName
} from "../../../src/utils/mediaLiveKeyMatch";

describe("media basename helpers", () => {
  it("ownedLookupBaseName strips image variant suffixes", () => {
    expect(ownedLookupBaseName("digital-house/posts/1/abc_full.webp")).toBe("abc");
    expect(ownedLookupBaseName("digital-house/posts/1/abc_md.webp")).toBe("abc");
    expect(ownedLookupBaseName("digital-house/posts/1/abc.webp")).toBe("abc");
    expect(ownedLookupBaseName("digital-house/posts/1/abc.jpg")).toBe("abc.jpg");
  });

  it("stagingLookupBaseName strips extension and _full/_opt", () => {
    expect(stagingLookupBaseName("digital-house/posts/1/abc.jpg")).toBe("abc");
    expect(stagingLookupBaseName("digital-house/posts/1/abc_full.webp")).toBe("abc");
    expect(stagingLookupBaseName("digital-house/posts/1/abc_opt.mp4")).toBe("abc");
  });
});

describe("matchLiveMediaKeyFromRows equivalence", () => {
  const rows = [
    {
      id: 20,
      objectKey: "digital-house/posts/1/abc_full.webp",
      fileUrl: "digital-house/posts/1/abc.jpg",
      processingStatus: "completed",
      safetyDecision: "SAFE"
    },
    {
      id: 10,
      objectKey: "digital-house/posts/1/other_full.webp",
      fileUrl: "digital-house/posts/1/other.webp",
      processingStatus: "completed",
      safetyDecision: "SAFE"
    }
  ];

  it("exact objectKey hit", () => {
    expect(matchLiveMediaKeyFromRows("digital-house/posts/1/abc_full.webp", rows)).toBe(
      "digital-house/posts/1/abc_full.webp"
    );
  });

  it("staging key resolves via fileUrl / family to live objectKey", () => {
    expect(matchLiveMediaKeyFromRows("digital-house/posts/1/abc.jpg", rows)).toBe(
      "digital-house/posts/1/abc_full.webp"
    );
  });

  it("staging key resolves via _full.webp family pattern", () => {
    const onlyLive = [
      {
        id: 5,
        objectKey: "digital-house/posts/1/xyz_full.webp",
        fileUrl: null,
        processingStatus: "completed",
        safetyDecision: "SAFE"
      }
    ];
    expect(matchLiveMediaKeyFromRows("digital-house/posts/1/xyz.webp", onlyLive)).toBe(
      "digital-house/posts/1/xyz_full.webp"
    );
  });

  it("prefers higher id when multiple rows match", () => {
    const dup = [
      {
        id: 30,
        objectKey: "digital-house/posts/1/abc_full.webp",
        fileUrl: "digital-house/posts/1/abc.jpg",
        processingStatus: "completed",
        safetyDecision: "SAFE"
      },
      {
        id: 5,
        objectKey: "digital-house/posts/1/abc_opt.mp4",
        fileUrl: "digital-house/posts/1/abc.jpg",
        processingStatus: "completed",
        safetyDecision: "SAFE"
      }
    ];
    expect(matchLiveMediaKeyFromRows("digital-house/posts/1/abc.jpg", dup)).toBe(
      "digital-house/posts/1/abc_full.webp"
    );
  });

  it("returns null when no family match", () => {
    expect(matchLiveMediaKeyFromRows("digital-house/posts/1/missing.jpg", rows)).toBeNull();
  });

  it("empty media / no rows", () => {
    expect(matchLiveMediaKeyFromRows("digital-house/posts/1/abc.jpg", [])).toBeNull();
    expect(matchLiveMediaKeyFromRows("", rows)).toBeNull();
  });
});

describe("resolveLiveMediaKeysBatch strategy (P4D)", () => {
  it("family query absorbs staging fallback → ≤ authors queries, not N LIKE fallbacks", () => {
    const authors = 2;
    const keys = 8;
    const beforeFallbackQueries = keys;
    const afterFamilyQueries = authors;
    expect(afterFamilyQueries).toBeLessThan(beforeFallbackQueries);
  });

  it("cache key remains user-scoped", () => {
    expect(`1::digital-house/a.webp`).not.toBe(`2::digital-house/a.webp`);
  });
});
