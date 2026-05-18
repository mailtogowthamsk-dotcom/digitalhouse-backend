import type { User } from "../models/user.model";
import type { MatrimonySection } from "../models/UserProfile.model";
import { isMatrimonyForSelf } from "../constants/matrimony-photo.constants";

export type MatrimonyCandidatePublic = {
  userId: number;
  name: string;
  age: number | null;
  gender: string | null;
  district: string | null;
  occupation: string | null;
  education: string | null;
  kulam: string | null;
  height: string | null;
  complexion: string | null;
  aboutMe: string | null;
  lookingFor: string | null;
  familyManaged: boolean;
  horoscopeAvailable: boolean;
  verified: boolean;
};

export function calcAgeFromDob(dob: Date | string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age >= 0 && age < 120 ? age : null;
}

function genderFromLookingFor(lookingFor: string | null | undefined): string | null {
  const lf = String(lookingFor ?? "").toUpperCase();
  if (lf === "SON" || lf === "BROTHER") return "MALE";
  if (lf === "DAUGHTER" || lf === "SISTER") return "FEMALE";
  return null;
}

/** Public bride/groom identity — never account owner fields for family profiles. */
export function resolveMatrimonyCandidate(
  user: Pick<User, "id" | "fullName" | "gender" | "dob" | "district" | "occupation" | "education">,
  matrimony: MatrimonySection | Record<string, unknown>
): MatrimonyCandidatePublic {
  const m = matrimony as MatrimonySection;
  const lookingFor = m.lookingFor ?? null;
  const familyManaged = !isMatrimonyForSelf(lookingFor);

  const inferredGender = genderFromLookingFor(lookingFor);
  const gender = familyManaged
    ? (m.candidateGender ?? inferredGender)
    : (m.candidateGender ?? user.gender ?? inferredGender);

  const candidateAge =
    typeof m.candidateAge === "number" && !Number.isNaN(m.candidateAge)
      ? m.candidateAge
      : familyManaged
        ? null
        : calcAgeFromDob(user.dob);

  const name =
    (typeof m.candidateName === "string" && m.candidateName.trim()) ||
    (familyManaged
      ? `${lookingFor === "SON" ? "Son" : lookingFor === "DAUGHTER" ? "Daughter" : lookingFor === "BROTHER" ? "Brother" : lookingFor === "SISTER" ? "Sister" : "Candidate"} profile`
      : user.fullName);

  const kulam =
    (typeof m.kulamSnapshot === "string" && m.kulamSnapshot.trim()) || null;

  const horoscopeAvailable = !!(
    typeof m.horoscopeDocumentUrl === "string" && m.horoscopeDocumentUrl.trim()
  );

  const photoOk =
    !m.candidatePhotoStatus ||
    m.candidatePhotoStatus === "APPROVED" ||
    m.candidatePhotoStatus === "PENDING_REVIEW";

  return {
    userId: user.id,
    name,
    age: candidateAge,
    gender,
    district:
      (typeof m.candidateDistrict === "string" && m.candidateDistrict.trim()) ||
      user.district ||
      null,
    occupation: m.occupation ?? user.occupation ?? null,
    education: m.education ?? user.education ?? null,
    kulam,
    height: m.height ?? null,
    complexion: m.complexion ?? null,
    aboutMe: m.aboutMe ?? null,
    lookingFor,
    familyManaged,
    horoscopeAvailable,
    verified: m.matrimonyProfileActive === true && photoOk
  };
}

export function normalizeMatchPair(userA: number, userB: number): { low: number; high: number } {
  return userA < userB ? { low: userA, high: userB } : { low: userB, high: userA };
}

export function kulamCompatibilityLabel(
  viewerKulam: string | null,
  candidateKulam: string | null
): "Same kulam" | "Compatible" | "Different kulam" | null {
  if (!viewerKulam || !candidateKulam) return null;
  const v = viewerKulam.trim().toLowerCase();
  const c = candidateKulam.trim().toLowerCase();
  if (v === c) return "Same kulam";
  return "Compatible";
}
