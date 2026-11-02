import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  STORY_CDN_CACHE_CONTROL,
  STORY_GATEWAY_CACHE_CONTROL,
  STORY_R2_OBJECT_CACHE_CONTROL,
  storyGatewayCacheHeaders
} from "../../src/config/storiesCache.config";
import { STORY_R2_KEY_PREFIX, STORY_TTL_MS } from "../../src/constants/stories.constants";
import { R2_CACHE_CONTROL_IMMUTABLE } from "../../src/config/r2Cache.config";

describe("Story cache policy", () => {
  it("gateway and R2 object headers forbid shared CDN storage", () => {
    expect(STORY_GATEWAY_CACHE_CONTROL).toMatch(/private/);
    expect(STORY_GATEWAY_CACHE_CONTROL).toMatch(/no-store/);
    expect(STORY_CDN_CACHE_CONTROL).toBe("no-store");
    expect(STORY_R2_OBJECT_CACHE_CONTROL).toMatch(/private/);
    expect(STORY_R2_OBJECT_CACHE_CONTROL).toMatch(/no-store/);
    expect(STORY_R2_OBJECT_CACHE_CONTROL).not.toMatch(/public/);
    expect(STORY_R2_OBJECT_CACHE_CONTROL).not.toBe(R2_CACHE_CONTROL_IMMUTABLE);
  });

  it("gateway header helper sets Cache-Control and CDN-Cache-Control", () => {
    const h = storyGatewayCacheHeaders();
    expect(h["Cache-Control"]).toBe(STORY_GATEWAY_CACHE_CONTROL);
    expect(h["CDN-Cache-Control"]).toBe("no-store");
    expect(h["Surrogate-Control"]).toBe("no-store");
  });

  it("Story object keys sit under the private prefix (public CDN must deny)", () => {
    expect(STORY_R2_KEY_PREFIX.startsWith("digital-house/private/")).toBe(true);
    expect(STORY_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("mobile disk cache is viewer-scoped, 26h / 256MB, with live revalidate", () => {
    const constantsSrc = fs.readFileSync(
      path.resolve(__dirname, "../../../mobile/src/config/stories.constants.ts"),
      "utf8"
    );
    expect(constantsSrc).toMatch(/STORY_MEDIA_CACHE_MAX_AGE_MS\s*=\s*26\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
    expect(constantsSrc).toMatch(/STORY_MEDIA_CACHE_MAX_BYTES\s*=\s*256\s*\*\s*1024\s*\*\s*1024/);

    const cacheSrc = fs.readFileSync(
      path.resolve(__dirname, "../../../mobile/src/utils/storyMediaCache.ts"),
      "utf8"
    );
    expect(cacheSrc).toMatch(/u\$\{userId\}-story-\$\{storyId\}-\$\{kind\}/);
    expect(cacheSrc).toMatch(/revalidateLive/);
    expect(cacheSrc).toMatch(/clearAllStoryMediaCache/);
    expect(cacheSrc).toMatch(/entry\.userId !== cacheUserId/);
    expect(cacheSrc).toMatch(/class StoryMediaUnauthorizedError/);
    expect(cacheSrc).toMatch(/throw new StoryMediaUnauthorizedError/);
    expect(cacheSrc).toMatch(/evictStoryMediaCacheForUser/);
  });

  it("viewer revalidates disk hits via getStory before playback", () => {
    const viewerSrc = fs.readFileSync(
      path.resolve(__dirname, "../../../mobile/src/screens/stories/StoryViewerScreen.tsx"),
      "utf8"
    );
    expect(viewerSrc).toMatch(/revalidateLive:/);
    expect(viewerSrc).toMatch(/getStory\(story\.id\)/);
    expect(viewerSrc).toMatch(/StoryMediaUnauthorizedError/);
    expect(viewerSrc).toMatch(/setPlayUri\(null\)/);
  });

  it("logout clears story disk cache and sticky signed URLs", () => {
    const authSrc = fs.readFileSync(
      path.resolve(__dirname, "../../../mobile/src/context/AuthContext.tsx"),
      "utf8"
    );
    expect(authSrc).toMatch(/clearAllStoryMediaCache/);
    expect(authSrc).toMatch(/setStoryMediaCacheUserId/);
    expect(authSrc).toMatch(/clearStickySignedMediaUrls/);
  });
});

describe("public CDN deny for private Story prefix (live)", () => {
  it("does not 200 a Story object path on the media custom domain", async () => {
    // Do not use R2_CDN_PUBLIC_URL from tests/setup/env.ts (cdn.test.local).
    const cdn = (
      process.env.STORY_CDN_LIVE_PROBE_URL || "https://media.konguvettuvagounder.com"
    ).replace(/\/$/, "");
    if (/test\.local|localhost|127\.0\.0\.1/i.test(cdn)) {
      console.warn("[stories-cdn-probe] skipped — probe URL is not a live CDN");
      return;
    }
    const url = `${cdn}/${STORY_R2_KEY_PREFIX}cdn-probe/does-not-exist.mp4`;

    const probe = async (): Promise<Response> => {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 10_000);
      try {
        return await fetch(url, { method: "GET", redirect: "manual", signal: ac.signal });
      } finally {
        clearTimeout(t);
      }
    };

    let first: Response;
    try {
      first = await probe();
    } catch (e) {
      const code = (e as { cause?: { code?: string }; code?: string })?.cause?.code
        ?? (e as { code?: string })?.code
        ?? "";
      if (code === "ENOTFOUND" || code === "ECONNREFUSED" || /fetch failed|abort/i.test(String(e))) {
        console.warn("[stories-cdn-probe] skipped — media host not reachable from this environment");
        return;
      }
      throw e;
    }

    expect(first.status).not.toBe(200);
    expect(first.status).toBeGreaterThanOrEqual(400);

    const cf1 = (first.headers.get("cf-cache-status") ?? "").toUpperCase();
    const cacheControl = first.headers.get("cache-control") ?? "";
    if (cf1) {
      expect(["HIT", "MISS", "EXPIRED", "DYNAMIC", "BYPASS", "DENIED", "REVALIDATED", "NONE"]).toContain(
        cf1
      );
    }

    // Repeat: Cloudflare may cache the deny/404 HTML. A HIT of 4xx is fine;
    // a HIT of 200 would leak private bytes and already failed above.
    const second = await probe();
    expect(second.status).not.toBe(200);
    expect(second.status).toBeGreaterThanOrEqual(400);
    const cf2 = (second.headers.get("cf-cache-status") ?? "").toUpperCase();
    if (cf2) {
      expect(["HIT", "MISS", "EXPIRED", "DYNAMIC", "BYPASS", "DENIED", "REVALIDATED", "NONE"]).toContain(
        cf2
      );
    }
    expect(typeof cacheControl).toBe("string");
  }, 20_000);
});
