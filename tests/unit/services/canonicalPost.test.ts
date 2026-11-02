import { describe, expect, it } from "vitest";
import { resolveOriginalPostId } from "../../../src/services/post/originalPostId";

describe("resolveOriginalPostId", () => {
  it("returns the original id for a repost wrapper", () => {
    expect(resolveOriginalPostId({ id: 88, originalPostId: 12 })).toBe(12);
  });

  it("returns the post id when this is the original", () => {
    expect(resolveOriginalPostId({ id: 12, originalPostId: null })).toBe(12);
    expect(resolveOriginalPostId({ id: 12 })).toBe(12);
  });
});
