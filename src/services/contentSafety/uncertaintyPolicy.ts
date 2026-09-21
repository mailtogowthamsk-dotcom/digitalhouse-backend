import {
  CONTENT_SAFETY_POLICY_VERSION,
  PROHIBITED_SEXUAL_CATEGORIES,
  PROHIBITED_VIOLENCE_CATEGORIES
} from "../../constants/contentSafety.constants";
import type { NormalizedModerationResult, PolicyEvaluation } from "./types";

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
 *
 * Soft UNCERTAIN from a completed model run (available=true) may auto-SAFE.
 * Download / fetch / model failures stay REVIEW — never public (marketplace auto-LIVE
 * depends on SAFE; fail-closed is required).
 */
export function allowNonSexualUncertainty(
  evaluation: PolicyEvaluation,
  result: Pick<
    NormalizedModerationResult,
    | "failureReason"
    | "failed"
    | "timeout"
    | "corrupt"
    | "unsupported"
    | "insufficientCoverage"
    | "available"
  >
): PolicyEvaluation {
  if (evaluation.verdict !== "REVIEW") return evaluation;
  if (isProhibitedSafetyCategory(evaluation.category)) return evaluation;

  if (
    result.failed ||
    result.timeout ||
    result.corrupt ||
    result.unsupported ||
    result.insufficientCoverage ||
    result.available === false
  ) {
    return evaluation;
  }

  const reason = `${evaluation.reason ?? ""} ${result.failureReason ?? ""}`.toLowerCase();
  if (
    reason.includes("fetch failed") ||
    reason.includes("download_failed") ||
    reason.includes("model_unavailable") ||
    reason.includes("model_timeout") ||
    reason.includes("model_failure")
  ) {
    return evaluation;
  }

  if (evaluation.category !== "UNCERTAIN") return evaluation;

  return {
    verdict: "SAFE",
    category: "SAFE",
    confidence: evaluation.confidence,
    reason: "AUTO_ALLOW_NON_SEXUAL_UNCERTAIN",
    policyVersion: evaluation.policyVersion || CONTENT_SAFETY_POLICY_VERSION
  };
}
