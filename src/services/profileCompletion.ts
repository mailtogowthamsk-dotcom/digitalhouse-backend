/**
 * Profile completion based on mandatory fields only.
 * Matrimony / business / social / family extras do NOT inflate the percentage.
 */

export function isFilledValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return !Number.isNaN(value);
  if (typeof value === "boolean") return false; // flags alone never count as profile data
  if (Array.isArray(value)) return value.length > 0;
  return false;
}

export type MandatoryFieldKey =
  | "fullName"
  | "username"
  | "email"
  | "mobile"
  | "gender"
  | "dob"
  | "profilePhoto"
  | "kulam"
  | "nativeDistrict"
  | "occupation"
  | "maritalStatus"
  | "currentLocation";

/** Ordered mandatory fields (denominator). Keep in sync with product rules. */
export const MANDATORY_PROFILE_FIELDS: readonly MandatoryFieldKey[] = [
  "fullName",
  "username",
  "email",
  "mobile",
  "gender",
  "dob",
  "profilePhoto",
  "kulam",
  "nativeDistrict",
  "occupation",
  "maritalStatus",
  "currentLocation"
] as const;

export type MandatoryFieldSources = {
  fullName: unknown;
  username: unknown;
  email: unknown;
  mobile: unknown;
  gender: unknown;
  dob: unknown;
  profilePhoto: unknown;
  /** Prefer community.kulam; fall back to users.kulam for legacy registrations. */
  kulam: unknown;
  /** Prefer users.district; fall back to users.location. */
  nativeDistrict: unknown;
  /** Prefer personal.occupation; fall back to users.occupation. */
  occupation: unknown;
  maritalStatus: unknown;
  /** Prefer personal.currentLocation; fall back to users.city. */
  currentLocation: unknown;
};

export function computeMandatoryCompletion(sources: MandatoryFieldSources): {
  filled: number;
  total: number;
  completion_percentage: number;
  missing: MandatoryFieldKey[];
} {
  const missing: MandatoryFieldKey[] = [];
  let filled = 0;
  for (const key of MANDATORY_PROFILE_FIELDS) {
    if (isFilledValue(sources[key])) filled += 1;
    else missing.push(key);
  }
  const total = MANDATORY_PROFILE_FIELDS.length;
  const completion_percentage = total > 0 ? Math.round((100 * filled) / total) : 0;
  return {
    filled,
    total,
    completion_percentage: Math.min(100, Math.max(0, completion_percentage)),
    missing
  };
}
