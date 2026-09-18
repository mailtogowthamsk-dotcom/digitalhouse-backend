import {
  CONTENT_SAFETY_POLICY_VERSION,
  PROHIBITED_SEXUAL_CATEGORIES,
  PROHIBITED_VIOLENCE_CATEGORIES
} from "../../constants/contentSafety.constants";
import type { NormalizedModerationResult, PolicyEvaluation } from "./types";

const TECHNICAL_FAILURE_REASONS = [
  "MODEL_UNAVAILABLE",
  "MODEL_TIMEOUT",
  "DOWNLOAD_FAILED",
  "fetch failed",
  "MISSING_RESULT",
  "INSUFFICIENT_ANALYSIS",
  "UNSUPPORTED_MEDIA",
  "CORRUPTED_MEDIA",
  "UNCERTAIN_CLASSIFICATION",
  "UNKNOWN_CATEGORY"
] as const;

export function isProhibitedSafetyCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  return (
    (PROHIBITED_SEXUAL_CATEGORIES as readonly string[]).includes(category) ||
    (PROHIBITED_VIOLENCE_CATEGORIES as readonly string[]).includes(category) ||
    category === "OTHER_PROHIBITED"
  );
}

/**
 * Sexual/violence → keep REVIEW/BLOCK.
 * Technical uncertainty → SAFE so innocent posts are not stuck for admin.
 */
export function allowNonSexualUncertainty(
  evaluation: PolicyEvaluation,
  result: Pick<NormalizedModerationResult, "failureReason">
): PolicyEvaluation {
  if (evaluation.verdict !== "REVIEW") return evaluation;
  if (isProhibitedSafetyCategory(evaluation.category)) return evaluation;
  const reason = `${evaluation.reason ?? ""} ${result.failureReason ?? ""}`;
  const technical =
    evaluation.category === "UNCERTAIN" ||
    TECHNICAL_FAILURE_REASONS.some((r) => reason.includes(r));
  if (!technical) return evaluation;
  return {
    verdict: "SAFE",
    category: "SAFE",
    confidence: evaluation.confidence,
    reason: "AUTO_ALLOW_NON_SEXUAL_UNCERTAIN",
    policyVersion: evaluation.policyVersion || CONTENT_SAFETY_POLICY_VERSION
  };
}
