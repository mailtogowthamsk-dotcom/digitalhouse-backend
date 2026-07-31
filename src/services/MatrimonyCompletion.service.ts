import type { MatrimonySection } from "../models/UserProfile.model";
import { MATRIMONY_REQUIRED_KEYS } from "../constants/matrimony.constants";
import {
  isMatrimonyForSelf,
  resolveCandidatePhotoUrl,
  syncMatrimonyPhotoFields
} from "../constants/matrimony-photo.constants";

function fieldFilled(key: string, value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return !Number.isNaN(value);
  if (typeof value === "boolean") return key === "matrimonyProfileActive" ? value === true : true;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Merge approved matrimony + in-progress pending draft for completion checks.
 * Shared leaf module — depended on by member and admin matrimony services (no upward imports).
 */
export function computeMatrimonyCompletion(
  approved: MatrimonySection | null,
  draft: MatrimonySection | null,
  userPhoto: string | null,
  requestedFieldsOnly?: string[] | null
): { percentage: number; missing: string[] } {
  const merged: Record<string, unknown> = syncMatrimonyPhotoFields({
    ...(approved ?? {}),
    ...(draft ?? {}),
    matrimonyProfileActive: true
  });

  const keysToCheck =
    requestedFieldsOnly && requestedFieldsOnly.length > 0
      ? MATRIMONY_REQUIRED_KEYS.filter((k) => requestedFieldsOnly.includes(k))
      : [...MATRIMONY_REQUIRED_KEYS];

  const missing: string[] = [];
  for (const key of keysToCheck) {
    if (key === "candidatePhotoUrl") {
      const hasCandidate = !!resolveCandidatePhotoUrl(merged);
      const useAccount =
        isMatrimonyForSelf(merged.lookingFor) && merged.useAccountProfilePhoto === true && !!userPhoto;
      if (!hasCandidate && !useAccount) missing.push(key);
      continue;
    }
    if (!fieldFilled(key, merged[key])) {
      missing.push(key);
    }
  }
  const total = keysToCheck.length || MATRIMONY_REQUIRED_KEYS.length;
  const filled = total - missing.length;
  const percentage = total > 0 ? Math.round((100 * filled) / total) : 0;
  return { percentage: Math.min(100, percentage), missing };
}
