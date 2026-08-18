import {
  CONTENT_SAFETY_POLICY_VERSION,
  DEFAULT_SAFETY_THRESHOLDS,
  PROHIBITED_SEXUAL_CATEGORIES,
  PROHIBITED_VIOLENCE_CATEGORIES,
  type SafetyCategory
} from "../../constants/contentSafety.constants";
import type { NormalizedModerationResult, PolicyEvaluation } from "./types";

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function safetyThresholds() {
  return {
    blockSexual: envFloat("MODERATION_BLOCK_THRESHOLD", DEFAULT_SAFETY_THRESHOLDS.blockSexual),
    reviewSexual: envFloat("MODERATION_REVIEW_THRESHOLD", DEFAULT_SAFETY_THRESHOLDS.reviewSexual),
    blockSexy: envFloat("MODERATION_BLOCK_SEXY_THRESHOLD", DEFAULT_SAFETY_THRESHOLDS.blockSexy),
    reviewSexy: envFloat("MODERATION_REVIEW_SEXY_THRESHOLD", DEFAULT_SAFETY_THRESHOLDS.reviewSexy)
  };
}

function isProhibitedCategory(category: SafetyCategory): boolean {
  return (
    (PROHIBITED_SEXUAL_CATEGORIES as readonly string[]).includes(category) ||
    (PROHIBITED_VIOLENCE_CATEGORIES as readonly string[]).includes(category) ||
    category === "OTHER_PROHIBITED"
  );
}

/**
 * Authoritative DigitalHouse policy. Never maps failure/uncertain/missing to SAFE.
 */
export function evaluateModeration(result: NormalizedModerationResult): PolicyEvaluation {
  const policyVersion = CONTENT_SAFETY_POLICY_VERSION;

  if (result.corrupt) {
    return {
      verdict: "REVIEW",
      category: "UNCERTAIN",
      confidence: null,
      reason: "CORRUPTED_MEDIA",
      policyVersion
    };
  }
  if (result.unsupported) {
    return {
      verdict: "REVIEW",
      category: "UNCERTAIN",
      confidence: null,
      reason: "UNSUPPORTED_MEDIA",
      policyVersion
    };
  }
  if (result.timeout) {
    return {
      verdict: "REVIEW",
      category: "UNCERTAIN",
      confidence: null,
      reason: "MODEL_TIMEOUT",
      policyVersion
    };
  }
  if (result.failed || !result.available) {
    return {
      verdict: "REVIEW",
      category: "UNCERTAIN",
      confidence: null,
      reason: result.failureReason || "MODEL_UNAVAILABLE",
      policyVersion
    };
  }
  if (result.insufficientCoverage) {
    return {
      verdict: "REVIEW",
      category: "UNCERTAIN",
      confidence: result.confidence,
      reason: "INSUFFICIENT_ANALYSIS",
      policyVersion
    };
  }
  if (result.category === "UNCERTAIN") {
    return {
      verdict: "REVIEW",
      category: "UNCERTAIN",
      confidence: result.confidence,
      reason: "UNCERTAIN_CLASSIFICATION",
      policyVersion
    };
  }
  if (isProhibitedCategory(result.category)) {
    const confidence = result.confidence;
    const thresholds = safetyThresholds();
    if (confidence == null) {
      return {
        verdict: "REVIEW",
        category: result.category,
        confidence: null,
        reason: "MISSING_CONFIDENCE",
        policyVersion
      };
    }
    if (confidence >= thresholds.blockSexual) {
      return {
        verdict: "BLOCK",
        category: result.category,
        confidence,
        reason: "HIGH_CONFIDENCE_PROHIBITED",
        policyVersion
      };
    }
    return {
      verdict: "REVIEW",
      category: result.category,
      confidence,
      reason: "PROHIBITED_CATEGORY_BELOW_BLOCK_THRESHOLD",
      policyVersion
    };
  }
  if (result.category === "SAFE") {
    return {
      verdict: "SAFE",
      category: "SAFE",
      confidence: result.confidence,
      reason: "POLICY_SAFE",
      policyVersion
    };
  }
  return {
    verdict: "REVIEW",
    category: "UNCERTAIN",
    confidence: result.confidence,
    reason: "UNKNOWN_CATEGORY",
    policyVersion
  };
}

/** Worst-wins aggregation for multi-frame / text+media. */
export function combinePolicyEvaluations(parts: PolicyEvaluation[]): PolicyEvaluation {
  if (parts.length === 0) {
    return {
      verdict: "REVIEW",
      category: "UNCERTAIN",
      confidence: null,
      reason: "MISSING_RESULT",
      policyVersion: CONTENT_SAFETY_POLICY_VERSION
    };
  }
  const blocked = parts.filter((p) => p.verdict === "BLOCK");
  if (blocked.length > 0) {
    return blocked.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0]!;
  }
  const review = parts.filter((p) => p.verdict === "REVIEW");
  if (review.length > 0) {
    return review[0]!;
  }
  return parts[0]!;
}

export function policyVerdictToSafetyDecision(
  verdict: PolicyEvaluation["verdict"]
): "SAFE" | "REVIEW_REQUIRED" | "BLOCKED" {
  if (verdict === "SAFE") return "SAFE";
  if (verdict === "BLOCK") return "BLOCKED";
  return "REVIEW_REQUIRED";
}
