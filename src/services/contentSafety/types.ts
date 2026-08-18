import type {
  PolicyVerdict,
  SafetyCategory,
  SafetyDecision
} from "../../constants/contentSafety.constants";

export type NormalizedModerationResult = {
  /** Provider completed a usable classification. */
  available: boolean;
  category: SafetyCategory;
  /** 0–1. Null when the provider could not score. */
  confidence: number | null;
  /** True when the model/process failed, timed out, or returned nothing usable. */
  failed: boolean;
  timeout: boolean;
  corrupt: boolean;
  unsupported: boolean;
  insufficientCoverage: boolean;
  modelName: string;
  modelVersion: string;
  rawScores?: Record<string, number>;
  failureReason?: string;
};

export type PolicyEvaluation = {
  verdict: PolicyVerdict;
  category: SafetyCategory;
  confidence: number | null;
  reason: string;
  policyVersion: string;
};

export type TextModerationResult = {
  verdict: PolicyVerdict;
  category: SafetyCategory;
  reason: string;
};

export type SafetyPublicationGate = {
  eligible: boolean;
  reason: string;
};

export type ContentSafetyScanInput = {
  postId: number | null;
  mediaId: number | null;
  jobId: number | null;
  mediaVersion: number;
  mediaType: "image" | "video" | "text" | "unknown";
  model: string;
  modelVersion: string;
  policyVersion: string;
  status: SafetyDecision;
  category: SafetyCategory;
  confidence: number | null;
  decision: PolicyVerdict | "FAILED";
  failureReason: string | null;
  processingTimeMs: number | null;
};
