/** Who the matrimony application is for (applicant relationship to candidate). */
export const MATRIMONY_PROFILE_FOR = [
  { value: "SELF", label: "Myself" },
  { value: "SON", label: "Son" },
  { value: "DAUGHTER", label: "Daughter" },
  { value: "BROTHER", label: "Brother" },
  { value: "SISTER", label: "Sister" }
] as const;

export type MatrimonyProfileFor = (typeof MATRIMONY_PROFILE_FOR)[number]["value"];

export const MATRIMONY_CANDIDATE_PHOTO_STATUSES = [
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "REUPLOAD_REQUESTED"
] as const;

export type MatrimonyCandidatePhotoStatus = (typeof MATRIMONY_CANDIDATE_PHOTO_STATUSES)[number];

export type MatrimonyCandidatePhotoEntry = {
  id: string;
  url: string;
  status: MatrimonyCandidatePhotoStatus;
  isPrimary?: boolean;
  adminRemarks?: string | null;
};

export function isMatrimonyForSelf(lookingFor: unknown): boolean {
  return String(lookingFor ?? "").toUpperCase() === "SELF";
}

/** Bride/groom photo only — never the social account photo field. */
export function resolveCandidatePhotoUrl(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  const v =
    data.candidatePhotoUrl ??
    data.profilePhotoUrl ??
    (Array.isArray(data.candidatePhotos) &&
      (data.candidatePhotos as MatrimonyCandidatePhotoEntry[]).find((p) => p.isPrimary)?.url) ??
    (Array.isArray(data.candidatePhotos) &&
      (data.candidatePhotos as MatrimonyCandidatePhotoEntry[])[0]?.url);
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

/** Persist candidate photo under both keys for backward-compatible admin/list reads. */
export function syncMatrimonyPhotoFields(data: Record<string, unknown>): Record<string, unknown> {
  const candidate = resolveCandidatePhotoUrl(data);
  const out = { ...data };
  if (candidate) {
    out.candidatePhotoUrl = candidate;
    out.profilePhotoUrl = candidate;
  }
  if (!isMatrimonyForSelf(out.lookingFor)) {
    out.useAccountProfilePhoto = false;
  }
  if (out.candidatePhotoStatus == null && candidate) {
    out.candidatePhotoStatus = "PENDING_REVIEW";
  }
  return out;
}

export function validateCandidatePhotoRules(
  data: Record<string, unknown>,
  accountProfilePhoto: string | null
): { ok: boolean; message?: string } {
  const lookingFor = data.lookingFor;
  const isSelf = isMatrimonyForSelf(lookingFor);
  const candidate = resolveCandidatePhotoUrl(data);
  const useAccount = data.useAccountProfilePhoto === true;

  if (!lookingFor) {
    return { ok: false, message: "Please select who this matrimony profile is for." };
  }

  if (!isSelf) {
    if (!candidate) {
      return {
        ok: false,
        message:
          "Please upload a clear bride/groom photo. Account profile photos cannot be used when the profile is for a family member."
      };
    }
    return { ok: true };
  }

  if (candidate) return { ok: true };
  if (useAccount && accountProfilePhoto?.trim()) return { ok: true };
  return {
    ok: false,
    message:
      "Upload a bride/groom matrimony photo, or choose to use your current account profile photo."
  };
}
