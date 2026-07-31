import { describe, it, expect } from "vitest";
import {
  collectMediaArtifactKeys,
  imageStagingCandidatesFromFullKey,
  videoStagingKeyFromOptimized,
  videoOptimizedKey
} from "../../src/utils/mediaArtifactKeys";

describe("mediaArtifactKeys", () => {
  it("expands image full key to variants + staging candidates", () => {
    const full = "digital-house/images/posts/posts/2026/07/abc_full.webp";
    const keys = collectMediaArtifactKeys(full);
    expect(keys).toContain(full);
    expect(keys).toContain("digital-house/images/posts/posts/2026/07/abc_md.webp");
    expect(keys).toContain("digital-house/images/posts/posts/2026/07/abc_thumb.webp");
    expect(imageStagingCandidatesFromFullKey(full)).toContain(
      "digital-house/images/posts/posts/2026/07/abc.webp"
    );
  });

  it("expands optimized video to staging + posters", () => {
    const staging = "digital-house/videos/posts/2026/07/clip.mp4";
    const opt = videoOptimizedKey(staging);
    expect(opt).toBe("digital-house/videos/posts/2026/07/clip_opt.mp4");
    expect(videoStagingKeyFromOptimized(opt)).toBe(staging);
    const keys = collectMediaArtifactKeys(opt);
    expect(keys).toContain(staging);
    expect(keys).toContain(opt);
    expect(keys.some((k) => k.includes("_poster_md.webp"))).toBe(true);
  });
});
