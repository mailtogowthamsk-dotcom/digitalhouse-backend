export const MATRIMONY_REJECTION_REASONS = [
  { code: "INCOMPLETE_PROFILE", label: "Incomplete profile" },
  { code: "INVALID_KULAM", label: "Invalid kulam details" },
  { code: "POOR_PHOTOS", label: "Poor quality photos" },
  { code: "COMMUNITY_VERIFICATION_FAILED", label: "Community verification failed" },
  { code: "FAKE_INFORMATION", label: "Fake information" },
  { code: "DUPLICATE_PROFILE", label: "Duplicate profile" },
  { code: "OTHER", label: "Other" }
] as const;

export const MATRIMONY_CHANGE_REQUEST_TEMPLATES = [
  "Please upload a clearer profile photo.",
  "Please upload a valid horoscope document (PDF or image).",
  "Please complete family details section.",
  "Please correct kulam / community information.",
  "Please update education and occupation details."
] as const;

export const MATRIMONY_VERIFICATION_KEYS = [
  "genuineCommunityMember",
  "kulamVerified",
  "horoscopeVerified",
  "familyVerified",
  "profileQualityApproved"
] as const;

export type MatrimonyVerificationKey = (typeof MATRIMONY_VERIFICATION_KEYS)[number];
