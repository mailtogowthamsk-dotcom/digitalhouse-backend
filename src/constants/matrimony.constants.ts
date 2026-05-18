/** Annual income codes for matrimony profiles */
export const MATRIMONY_INCOME_RANGES = [
  { code: "NOT_EMPLOYED", label: "Not employed / Student" },
  { code: "BELOW_2L", label: "Below ₹2 Lakhs" },
  { code: "LAKHS_2_5", label: "₹2 – 5 Lakhs" },
  { code: "LAKHS_5_10", label: "₹5 – 10 Lakhs" },
  { code: "LAKHS_10_15", label: "₹10 – 15 Lakhs" },
  { code: "LAKHS_15_25", label: "₹15 – 25 Lakhs" },
  { code: "LAKHS_25_50", label: "₹25 – 50 Lakhs" },
  { code: "ABOVE_50L", label: "Above ₹50 Lakhs" },
  { code: "PREFER_NOT_SAY", label: "Prefer not to say" }
] as const;

export const MATRIMONY_HEIGHT_OPTIONS = [
  "4'6\"", "4'7\"", "4'8\"", "4'9\"", "4'10\"", "4'11\"",
  "5'0\"", "5'1\"", "5'2\"", "5'3\"", "5'4\"", "5'5\"", "5'6\"", "5'7\"", "5'8\"", "5'9\"",
  "5'10\"", "5'11\"", "6'0\"", "6'1\"", "6'2\"", "6'3\""
].map((h) => ({ value: h, label: h }));

export const MATRIMONY_COMPLEXION_OPTIONS = [
  "Very Fair", "Fair", "Wheatish", "Wheatish Brown", "Dark", "Prefer not to say"
].map((c) => ({ value: c, label: c }));

export const PARTNER_GENDER_OPTIONS = [
  { value: "MALE", label: "Male" },
  { value: "FEMALE", label: "Female" }
] as const;

/** Keys required before submit (values must be non-empty) */
export const MATRIMONY_REQUIRED_KEYS = [
  "matrimonyProfileActive",
  "lookingFor",
  "partnerGenderPreference",
  "height",
  "complexion",
  "motherTongue",
  "aboutMe",
  "gotra",
  "education",
  "occupation",
  "employer",
  "annualIncome",
  "maritalStatus",
  "rashi",
  "nakshatram",
  "dosham",
  "motherName",
  "fatherOccupation",
  "brothersCount",
  "sistersCount",
  "familyType",
  "partnerAgeMin",
  "partnerAgeMax",
  "preferredDistrictIds",
  "preferredKulamIds",
  "candidatePhotoUrl",
  "horoscopeDocumentUrl"
] as const;

/** Discovery & admin matrimony media — never users.profile_photo */
export const MATRIMONY_CANDIDATE_MEDIA_KEYS = ["candidatePhotoUrl", "profilePhotoUrl"] as const;

export const MATRIMONY_SENSITIVE_KEYS = [
  "candidatePhotoUrl",
  "profilePhotoUrl",
  "horoscopeDocumentUrl",
  "kulamSnapshot"
] as const;
