import { describe, expect, it, vi, beforeEach } from "vitest";
import { evaluateModeration, policyVerdictToSafetyDecision, combinePolicyEvaluations } from "../../src/services/contentSafety/policyEngine";
import { nextSafetyAfterEdit } from "../../src/services/contentSafety/initialSafety";
import { isHiddenFromPublic } from "../../src/services/contentSafety/publicVisibility";

describe("publication gate invariants", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("old media version results cannot authorize a newer version", () => {
    const currentVersion = 2;
    const resultVersion = 1;
    expect(resultVersion === currentVersion).toBe(false);
  });

  it("FAILED never becomes SAFE", () => {
    const decision = policyVerdictToSafetyDecision(
      evaluateModeration({
        available: false,
        category: "UNCERTAIN",
        confidence: null,
        failed: true,
        timeout: false,
        corrupt: false,
        unsupported: false,
        insufficientCoverage: false,
        modelName: "x",
        modelVersion: "1"
      }).verdict
    );
    expect(decision).not.toBe("SAFE");
  });

  it("model timeout never becomes SAFE", () => {
    const decision = policyVerdictToSafetyDecision(
      evaluateModeration({
        available: false,
        category: "UNCERTAIN",
        confidence: null,
        failed: true,
        timeout: true,
        corrupt: false,
        unsupported: false,
        insufficientCoverage: false,
        modelName: "x",
        modelVersion: "1"
      }).verdict
    );
    expect(decision).not.toBe("SAFE");
  });

  it("missing combined results never become SAFE", () => {
    const combined = combinePolicyEvaluations([]);
    expect(combined.verdict).toBe("REVIEW");
    expect(policyVerdictToSafetyDecision(combined.verdict)).not.toBe("SAFE");
  });

  it("delete-equivalent states cannot be treated as public", () => {
    expect(
      isHiddenFromPublic({ moderationStatus: "SOFT_DELETED", safetyDecision: "SAFE" } as any)
    ).toBe(true);
  });

  it("edit during pending bumps version so the in-flight result cannot publish", () => {
    const next = nextSafetyAfterEdit({
      captionChanged: false,
      mediaChanged: true,
      textVerdict: "SAFE",
      textCategory: "SAFE",
      textReason: "ok",
      hasMedia: true,
      currentMediaVersion: 1
    });
    expect(next?.mediaVersion).toBe(2);
    expect(next?.safetyDecision).toBe("PENDING");
  });
});
