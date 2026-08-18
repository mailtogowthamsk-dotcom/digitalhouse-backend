import { describe, expect, it } from "vitest";
import { evaluateModeration, combinePolicyEvaluations, policyVerdictToSafetyDecision } from "../../src/services/contentSafety/policyEngine";
import { moderateText, isSevereSafetyReportReason } from "../../src/services/contentSafety/textModerator";
import { hammingHex, isKnownBadHashMatch } from "../../src/services/contentSafety/fingerprint";
import { planVideoFrameTimestamps } from "../../src/services/contentSafety/videoFrames";
import { initialSafetyForCreate, nextSafetyAfterEdit } from "../../src/services/contentSafety/initialSafety";
import { toQuarantineKey, publishedKeyFromQuarantine, needsUploadQuarantine } from "../../src/services/contentSafety/quarantineKeys";
import { isHiddenFromPublic, publicSafetyWhere } from "../../src/services/contentSafety/publicVisibility";
import { CONTENT_SAFETY_POLICY_VERSION } from "../../src/constants/contentSafety.constants";
import { isPrivateR2Object, toPublicUrlIfR2 } from "../../src/utils/r2Client";
import { roleHasAction } from "../../src/constants/adminRoles.constants";
import fs from "fs";
import path from "path";

function baseResult(overrides: Partial<Parameters<typeof evaluateModeration>[0]> = {}) {
  return {
    available: true,
    category: "SAFE" as const,
    confidence: 0.99,
    failed: false,
    timeout: false,
    corrupt: false,
    unsupported: false,
    insufficientCoverage: false,
    modelName: "test",
    modelVersion: "1",
    ...overrides
  };
}

describe("content safety policy engine", () => {
  it("blocks high-confidence explicit sexual content", () => {
    const out = evaluateModeration(baseResult({ category: "SEXUAL_EXPLICIT", confidence: 0.92 }));
    expect(out.verdict).toBe("BLOCK");
    expect(out.policyVersion).toBe(CONTENT_SAFETY_POLICY_VERSION);
  });

  it("blocks sexual activity and nudity categories", () => {
    expect(evaluateModeration(baseResult({ category: "SEXUAL_ACTIVITY", confidence: 0.8 })).verdict).toBe("BLOCK");
    expect(evaluateModeration(baseResult({ category: "SEXUAL_NUDITY", confidence: 0.8 })).verdict).toBe("BLOCK");
  });

  it("sends ambiguous sexual content to review, never SAFE", () => {
    const out = evaluateModeration(baseResult({ category: "SEXUALIZED_CONTENT", confidence: 0.3 }));
    expect(out.verdict).toBe("REVIEW");
  });

  it("blocks graphic violence and gore", () => {
    expect(evaluateModeration(baseResult({ category: "GRAPHIC_VIOLENCE", confidence: 0.8 })).verdict).toBe("BLOCK");
    expect(evaluateModeration(baseResult({ category: "BLOOD_GORE", confidence: 0.8 })).verdict).toBe("BLOCK");
  });

  it("never maps uncertain, timeout, failure, or missing result to SAFE", () => {
    expect(evaluateModeration(baseResult({ category: "UNCERTAIN", confidence: 0.4 })).verdict).toBe("REVIEW");
    expect(evaluateModeration(baseResult({ available: false, failed: true, timeout: true })).verdict).toBe("REVIEW");
    expect(evaluateModeration(baseResult({ available: false, failed: true })).verdict).toBe("REVIEW");
    expect(evaluateModeration(baseResult({ corrupt: true })).verdict).toBe("REVIEW");
    expect(evaluateModeration(baseResult({ unsupported: true })).verdict).toBe("REVIEW");
    expect(evaluateModeration(baseResult({ insufficientCoverage: true })).verdict).toBe("REVIEW");
  });

  it("allows a clearly safe classification", () => {
    expect(evaluateModeration(baseResult()).verdict).toBe("SAFE");
  });

  it("aggregates video frames with any BLOCK winning", () => {
    const combined = combinePolicyEvaluations([
      { verdict: "SAFE", category: "SAFE", confidence: 0.9, reason: "ok", policyVersion: "v1" },
      { verdict: "BLOCK", category: "SEXUAL_EXPLICIT", confidence: 0.8, reason: "frame", policyVersion: "v1" }
    ]);
    expect(combined.verdict).toBe("BLOCK");
  });

  it("maps policy verdicts to non-public decisions except SAFE", () => {
    expect(policyVerdictToSafetyDecision("SAFE")).toBe("SAFE");
    expect(policyVerdictToSafetyDecision("BLOCK")).toBe("BLOCKED");
    expect(policyVerdictToSafetyDecision("REVIEW")).toBe("REVIEW_REQUIRED");
  });
});

describe("text moderation", () => {
  it("blocks explicit sexual captions", () => {
    expect(moderateText("watch this porn video").verdict).toBe("BLOCK");
  });

  it("reviews ambiguous sexual solicitation", () => {
    expect(moderateText("check my sexy pic from the event").verdict).toBe("REVIEW");
  });

  it("passes a safe community caption", () => {
    expect(moderateText("Wedding photos from our family function").verdict).toBe("SAFE");
  });

  it("treats severe reports as safety-relevant", () => {
    expect(isSevereSafetyReportReason("this post has nudity")).toBe(true);
    expect(isSevereSafetyReportReason("spam")).toBe(false);
  });
});

describe("create-post safety gate", () => {
  it("keeps media posts pending (not public)", () => {
    const safety = initialSafetyForCreate({ title: "Hello", description: "family picnic", hasMedia: true });
    expect(safety.safetyDecision).toBe("PENDING");
    expect(safety.moderatedMediaVersion).toBeNull();
  });

  it("allows safe text-only posts", () => {
    const safety = initialSafetyForCreate({ title: "Hello", description: "community update", hasMedia: false });
    expect(safety.safetyDecision).toBe("SAFE");
    expect(safety.moderatedMediaVersion).toBe(1);
  });

  it("rejects clearly prohibited captions before create", () => {
    expect(() =>
      initialSafetyForCreate({ title: "xxx porn", description: null, hasMedia: false })
    ).toThrow(/prohibited language/i);
  });
});

describe("quarantine keys", () => {
  it("places UGC under private quarantine and can map back", () => {
    expect(needsUploadQuarantine("posts")).toBe(true);
    expect(needsUploadQuarantine("advertisements")).toBe(false);
    const q = toQuarantineKey("digital-house/images/posts/posts/2026/08/a.webp");
    expect(q.startsWith("digital-house/private/quarantine/")).toBe(true);
    expect(publishedKeyFromQuarantine(q)).toBe("digital-house/images/posts/posts/2026/08/a.webp");
  });
});

describe("public visibility", () => {
  it("hides pending/processing/review/rejected/failed from public", () => {
    for (const decision of ["PENDING", "PROCESSING", "REVIEW_REQUIRED", "BLOCKED", "FAILED"]) {
      expect(
        isHiddenFromPublic({
          moderationStatus: "ACTIVE",
          safetyDecision: decision
        } as any)
      ).toBe(true);
    }
    expect(
      isHiddenFromPublic({ moderationStatus: "ACTIVE", safetyDecision: "SAFE" } as any)
    ).toBe(false);
    expect(publicSafetyWhere()).toEqual({ safetyDecision: "SAFE" });
  });
});

describe("video sampling", () => {
  it("uses multiple frames, not first-frame-only", () => {
    const plan = planVideoFrameTimestamps(20);
    expect(plan.timestampsSec.length).toBeGreaterThanOrEqual(2);
    expect(plan.timestampsSec[0]).toBeGreaterThan(0);
    expect(plan.insufficientCoverage).toBe(false);
  });

  it("marks zero-duration as insufficient (cannot publish)", () => {
    expect(planVideoFrameTimestamps(0).insufficientCoverage).toBe(true);
  });
});

describe("fingerprint matching", () => {
  it("matches near-identical dHash values", () => {
    expect(isKnownBadHashMatch("ffffffffffffffff", "fffffffffffffffe")).toBe(true);
    expect(hammingHex("0000000000000000", "ffffffffffffffff")).toBeGreaterThan(5);
  });

  it("treats a known-bad perceptual match as a block signal", () => {
    const out = evaluateModeration(
      baseResult({ category: "OTHER_PROHIBITED", confidence: 1, modelName: "perceptual-fingerprint" })
    );
    expect(out.verdict).toBe("BLOCK");
  });
});

describe("edit / version safety", () => {
  it("unsafe new media cannot remain public", () => {
    const next = nextSafetyAfterEdit({
      captionChanged: false,
      mediaChanged: true,
      textVerdict: "SAFE",
      textCategory: "SAFE",
      textReason: "ok",
      hasMedia: true,
      currentMediaVersion: 1
    });
    expect(next?.safetyDecision).toBe("PENDING");
    expect(next?.mediaVersion).toBe(2);
    expect(next?.moderatedMediaVersion).toBeNull();
  });

  it("unsafe new caption cannot remain public", () => {
    const next = nextSafetyAfterEdit({
      captionChanged: true,
      mediaChanged: false,
      textVerdict: "BLOCK",
      textCategory: "SEXUAL_EXPLICIT",
      textReason: "caption",
      hasMedia: true,
      currentMediaVersion: 1
    });
    expect(next?.safetyDecision).toBe("BLOCKED");
    expect(next?.moderatedMediaVersion).toBeNull();
  });

  it("old moderation result cannot authorize a new media version", () => {
    const next = nextSafetyAfterEdit({
      captionChanged: false,
      mediaChanged: true,
      textVerdict: "SAFE",
      textCategory: "SAFE",
      textReason: "ok",
      hasMedia: true,
      currentMediaVersion: 4
    });
    expect(next?.mediaVersion).toBe(5);
    expect(next?.moderatedMediaVersion).toBeNull();
    expect(next?.mediaVersion === 4).toBe(false);
  });
});

describe("R2 quarantine URLs", () => {
  it("does not build a public CDN URL for quarantine keys", () => {
    const key = "digital-house/private/quarantine/images/posts/posts/2026/08/a.webp";
    expect(isPrivateR2Object(key)).toBe(true);
    expect(toPublicUrlIfR2(key)).toBeNull();
  });
});

describe("admin authorization", () => {
  it("rejects ALLOW for a role that is not in the catalog", () => {
    expect(roleHasAction("NOT_A_ROLE" as any, "posts.manage")).toBe(false);
  });

  it("safety-allow route is wrapped in posts.manage", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../src/routes/admin.routes.ts"),
      "utf8"
    );
    expect(src).toMatch(/\/posts\/:id\/safety-allow[\s\S]{0,180}requireAdminAction\("posts\.manage"\)/);
  });
});

describe("Feed fetch engine", () => {
  it("does not import inference, FFmpeg, or moderation providers", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../src/services/Feed.service.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/classifyImage|nsfwjs|tensorflow|extractModeration|ffmpeg|ContentSafety\.service/);
    expect(src).toMatch(/safetyDecision:\s*"SAFE"/);
  });
});
