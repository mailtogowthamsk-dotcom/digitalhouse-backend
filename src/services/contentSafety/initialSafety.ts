import {
  CONTENT_SAFETY_POLICY_VERSION,
  type SafetyDecision
} from "../../constants/contentSafety.constants";
import { moderateText } from "./textModerator";

export function initialSafetyForCreate(input: {
  title: string;
  description: string | null;
  hasMedia: boolean;
}): {
  safetyDecision: SafetyDecision;
  safetyCategory: string | null;
  safetyFailureReason: string | null;
  mediaVersion: number;
  moderatedMediaVersion: number | null;
  safetyPolicyVersion: string;
} {
  const text = moderateText(`${input.title}\n${input.description ?? ""}`);
  if (text.verdict === "BLOCK") {
    const err = new Error("This post contains prohibited language and cannot be published.");
    (err as any).status = 400;
    (err as any).code = "CONTENT_BLOCKED";
    throw err;
  }
  if (input.hasMedia) {
    return {
      safetyDecision: "PENDING",
      safetyCategory: text.verdict === "REVIEW" ? text.category : null,
      safetyFailureReason: null,
      mediaVersion: 1,
      moderatedMediaVersion: null,
      safetyPolicyVersion: CONTENT_SAFETY_POLICY_VERSION
    };
  }
  if (text.verdict === "REVIEW") {
    return {
      safetyDecision: "REVIEW_REQUIRED",
      safetyCategory: text.category,
      safetyFailureReason: text.reason,
      mediaVersion: 1,
      moderatedMediaVersion: null,
      safetyPolicyVersion: CONTENT_SAFETY_POLICY_VERSION
    };
  }
  return {
    safetyDecision: "SAFE",
    safetyCategory: "SAFE",
    safetyFailureReason: null,
    mediaVersion: 1,
    moderatedMediaVersion: 1,
    safetyPolicyVersion: CONTENT_SAFETY_POLICY_VERSION
  };
}

export type EditSafetyState = {
  safetyDecision: SafetyDecision;
  mediaVersion: number;
  moderatedMediaVersion: number | null;
  safetyCategory: string | null;
  safetyFailureReason: string | null;
  tryPublishTextOnly: boolean;
};

/**
 * Edit gate: new media always re-enters PENDING (old SAFE cannot authorize the new version).
 * Caption BLOCK/REVIEW never stays public. Unchanged media + SAFE caption is a no-op.
 */
export function nextSafetyAfterEdit(input: {
  captionChanged: boolean;
  mediaChanged: boolean;
  textVerdict: "SAFE" | "BLOCK" | "REVIEW";
  textCategory: string;
  textReason: string;
  hasMedia: boolean;
  currentMediaVersion: number;
}): EditSafetyState | null {
  if (!input.captionChanged && !input.mediaChanged) return null;
  if (input.textVerdict === "BLOCK") {
    return {
      safetyDecision: "BLOCKED",
      mediaVersion: input.currentMediaVersion,
      moderatedMediaVersion: null,
      safetyCategory: input.textCategory,
      safetyFailureReason: input.textReason,
      tryPublishTextOnly: false
    };
  }
  if (input.mediaChanged) {
    return {
      safetyDecision: "PENDING",
      mediaVersion: input.currentMediaVersion + 1,
      moderatedMediaVersion: null,
      safetyCategory: input.textVerdict === "REVIEW" ? input.textCategory : null,
      safetyFailureReason: null,
      tryPublishTextOnly: false
    };
  }
  if (input.textVerdict === "REVIEW") {
    return {
      safetyDecision: "REVIEW_REQUIRED",
      mediaVersion: input.currentMediaVersion,
      moderatedMediaVersion: null,
      safetyCategory: input.textCategory,
      safetyFailureReason: input.textReason,
      tryPublishTextOnly: false
    };
  }
  if (!input.hasMedia) {
    return {
      safetyDecision: "SAFE",
      mediaVersion: input.currentMediaVersion,
      moderatedMediaVersion: input.currentMediaVersion,
      safetyCategory: "SAFE",
      safetyFailureReason: null,
      tryPublishTextOnly: true
    };
  }
  return null;
}
