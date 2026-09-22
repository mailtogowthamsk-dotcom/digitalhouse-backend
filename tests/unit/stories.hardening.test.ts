import { afterEach, describe, expect, it } from "vitest";
import {
  STORY_VIDEO_MAX_DURATION_SEC,
  STORY_VIDEO_MIN_DURATION_SEC
} from "../../src/constants/stories.constants";
import {
  collectStoriesProductionEnvErrors,
  isWeakStoriesMediaSecret,
  resolveStoriesMediaSigningSecret
} from "../../src/config/storiesRuntime";
import {
  buildSignedStoryMediaPath,
  resolveStoryUploadMime,
  verifySignedStoryMediaQuery,
  STORY_UPLOAD_TMP_PREFIX,
  isPendingStoryUploadKey,
  LOCAL_STORY_KEY_PREFIX
} from "../../src/services/StoryLocalStorage.service";
import { detectMediaMimeFromBytes } from "../../src/utils/mediaMagic.util";

describe("stories duration constants", () => {
  it("aligns product bounds to 3–60 seconds", () => {
    expect(STORY_VIDEO_MIN_DURATION_SEC).toBe(3);
    expect(STORY_VIDEO_MAX_DURATION_SEC).toBe(60);
  });
});

describe("stories media signing secret", () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it("rejects weak secrets", () => {
    expect(isWeakStoriesMediaSecret("dev-stories-media-secret")).toBe(true);
    expect(isWeakStoriesMediaSecret("short")).toBe(true);
    expect(isWeakStoriesMediaSecret("a".repeat(32))).toBe(false);
  });

  it("production env collection fails without STORIES_MEDIA_SIGNING_SECRET", () => {
    delete process.env.STORIES_MEDIA_SIGNING_SECRET;
    delete process.env.STORIES_STORAGE_DIR;
    delete process.env.STORIES_CONTENT_SAFETY_MODE;
    delete process.env.API_INSTANCES;
    const errors: string[] = [];
    collectStoriesProductionEnvErrors(errors);
    expect(errors.some((e) => e.includes("STORIES_MEDIA_SIGNING_SECRET"))).toBe(true);
    expect(errors.some((e) => e.includes("STORIES_STORAGE_DIR"))).toBe(true);
    expect(errors.some((e) => e.includes("STORIES_CONTENT_SAFETY_MODE"))).toBe(true);
  });

  it("production env passes with strong secret + storage + safety mode", () => {
    process.env.STORIES_MEDIA_SIGNING_SECRET = "x".repeat(32);
    process.env.STORIES_STORAGE_DIR = "/var/stories";
    process.env.STORIES_CONTENT_SAFETY_MODE = "disabled";
    delete process.env.API_INSTANCES;
    const errors: string[] = [];
    collectStoriesProductionEnvErrors(errors);
    expect(errors).toEqual([]);
  });

  it("signs and verifies media URLs; rejects bad/expired signatures", () => {
    process.env.STORIES_MEDIA_SIGNING_SECRET = "unit-test-stories-secret-32chars!!";
    const path = buildSignedStoryMediaPath(42, 7, "file");
    const u = new URL(path, "http://localhost");
    expect(
      verifySignedStoryMediaQuery({
        storyId: 42,
        viewerId: 7,
        kind: "file",
        exp: u.searchParams.get("e") ?? undefined,
        sig: u.searchParams.get("s") ?? undefined
      })
    ).toBe(true);
    expect(
      verifySignedStoryMediaQuery({
        storyId: 42,
        viewerId: 7,
        kind: "file",
        exp: u.searchParams.get("e") ?? undefined,
        sig: "0".repeat(64)
      })
    ).toBe(false);
    expect(
      verifySignedStoryMediaQuery({
        storyId: 42,
        viewerId: 7,
        kind: "file",
        exp: String(Math.floor(Date.now() / 1000) - 10),
        sig: u.searchParams.get("s") ?? undefined
      })
    ).toBe(false);
  });

  it("resolveStoriesMediaSigningSecret never returns hardcoded prod fallback", () => {
    process.env.NODE_ENV = "development";
    delete process.env.STORIES_MEDIA_SIGNING_SECRET;
    process.env.JWT_ACCESS_SECRET = "dev-jwt-secret-at-least-16";
    const s = resolveStoriesMediaSigningSecret();
    expect(s).not.toBe("dev-stories-media-secret");
    expect(s.length).toBeGreaterThan(8);
  });
});

describe("stories upload mime sniff", () => {
  it("accepts real jpeg magic and rejects executable", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(detectMediaMimeFromBytes(jpeg)).toBe("image/jpeg");
    const { mime, kind } = resolveStoryUploadMime(jpeg, "image/jpeg");
    expect(mime).toBe("image/jpeg");
    expect(kind).toBe("image");
    expect(() =>
      resolveStoryUploadMime(Buffer.from([0x4d, 0x5a, 0x90, 0x00]), "image/jpeg")
    ).toThrow(/Unsupported/i);
  });

  it("detects pending tmp upload keys", () => {
    const key = `${LOCAL_STORY_KEY_PREFIX}1/2026/09/${STORY_UPLOAD_TMP_PREFIX}abc.mp4`;
    expect(isPendingStoryUploadKey(key)).toBe(true);
    expect(isPendingStoryUploadKey(`${LOCAL_STORY_KEY_PREFIX}1/2026/09/abc.mp4`)).toBe(false);
  });
});
