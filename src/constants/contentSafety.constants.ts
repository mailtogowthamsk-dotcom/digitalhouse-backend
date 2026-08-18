/**
 * DigitalHouse content-safety constants.
 *
 * Invariant: UNVERIFIED = NOT PUBLIC.
 * Provider labels must be normalized here — never branch on raw nsfwjs/class names
 * outside the local provider.
 */

export const CONTENT_SAFETY_POLICY_VERSION = "dh-safety-v1";

export const SAFETY_DECISIONS = [
  "PENDING",
  "PROCESSING",
  "SAFE",
  "REVIEW_REQUIRED",
  "BLOCKED",
  "FAILED"
] as const;
export type SafetyDecision = (typeof SAFETY_DECISIONS)[number];

/** Policy-engine outcomes (subset of SafetyDecision). */
export const POLICY_VERDICTS = ["SAFE", "BLOCK", "REVIEW"] as const;
export type PolicyVerdict = (typeof POLICY_VERDICTS)[number];

export const SAFETY_CATEGORIES = [
  "SAFE",
  "SEXUAL_NUDITY",
  "SEXUAL_EXPLICIT",
  "SEXUAL_ACTIVITY",
  "SEXUALIZED_CONTENT",
  "GRAPHIC_VIOLENCE",
  "BLOOD_GORE",
  "EXTREME_VIOLENCE",
  "GRAPHIC_SELF_HARM",
  "OTHER_PROHIBITED",
  "UNCERTAIN"
] as const;
export type SafetyCategory = (typeof SAFETY_CATEGORIES)[number];

export const PROHIBITED_SEXUAL_CATEGORIES: readonly SafetyCategory[] = [
  "SEXUAL_NUDITY",
  "SEXUAL_EXPLICIT",
  "SEXUAL_ACTIVITY",
  "SEXUALIZED_CONTENT"
];

export const PROHIBITED_VIOLENCE_CATEGORIES: readonly SafetyCategory[] = [
  "GRAPHIC_VIOLENCE",
  "BLOOD_GORE",
  "EXTREME_VIOLENCE",
  "GRAPHIC_SELF_HARM"
];

/**
 * Conservative starting thresholds for nsfwjs MobileNetV2 (0–1 probabilities).
 *
 * These are NOT claimed as calibrated production accuracy. They were chosen to
 * fail closed on sexual content for a family/community product:
 * - High porn/hentai → BLOCK (never public)
 * - Mid porn/hentai or high "sexy" → REVIEW (never public)
 * - Low prohibited scores → SAFE
 *
 * Re-tune only after running `scripts/benchmark-moderation.ts` on a controlled set.
 * Uncertain / missing / timeout never maps to SAFE (see policyEngine).
 */
export const DEFAULT_SAFETY_THRESHOLDS = {
  /** Sum of porn + hentai at or above this → BLOCK */
  blockSexual: 0.5,
  /** Sum of porn + hentai at or above this (below block) → REVIEW */
  reviewSexual: 0.2,
  /** nsfwjs "Sexy" at or above this → BLOCK (explicit pose / intimate) */
  blockSexy: 0.75,
  /** nsfwjs "Sexy" at or above this → REVIEW */
  reviewSexy: 0.5
} as const;

export const LOCAL_MODEL_NAME = "nsfwjs-mobilenet-v2";
export const LOCAL_MODEL_VERSION = "1.0.0";

export const PERCEPTUAL_HASH_ALGORITHM = "dhash-16";
/** Hamming distance for known-bad image match (resize/recompress/metadata). Not perfect. */
export const PERCEPTUAL_HASH_MAX_DISTANCE = 5;

export const QUARANTINE_PREFIX = "digital-house/private/quarantine/";

/** UGC modules whose new uploads stay in private quarantine until SAFE. */
export const QUARANTINE_MEDIA_MODULES = [
  "posts",
  "jobs",
  "marketplace",
  "help",
  "profile",
  "matrimony"
] as const;

export function isPublicSafetyDecision(decision: string | null | undefined): boolean {
  return decision === "SAFE";
}
