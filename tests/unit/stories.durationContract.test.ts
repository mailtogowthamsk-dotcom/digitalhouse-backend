/**
 * Drift guard — keep mobile stories.constants in sync with backend product bounds.
 * Values duplicated deliberately (separate packages); this test documents the contract.
 */
import { describe, expect, it } from "vitest";
import {
  STORY_VIDEO_MAX_DURATION_SEC,
  STORY_VIDEO_MIN_DURATION_SEC
} from "../../src/constants/stories.constants";
import fs from "fs";
import path from "path";

describe("stories mobile/backend duration contract", () => {
  it("backend bounds are 3–60", () => {
    expect(STORY_VIDEO_MIN_DURATION_SEC).toBe(3);
    expect(STORY_VIDEO_MAX_DURATION_SEC).toBe(60);
  });

  it("mobile stories.constants.ts declares the same bounds", () => {
    const mobilePath = path.resolve(
      __dirname,
      "../../../mobile/src/config/stories.constants.ts"
    );
    const src = fs.readFileSync(mobilePath, "utf8");
    expect(src).toMatch(/STORY_VIDEO_MIN_DURATION_SEC\s*=\s*3/);
    expect(src).toMatch(/STORY_VIDEO_MAX_DURATION_SEC\s*=\s*60/);
    expect(src).toMatch(/STORY_PREFETCH_MAX_ITEMS\s*=\s*3/);
    expect(src).toMatch(/STORY_PREFETCH_CONCURRENCY\s*=\s*2/);
  });
});
