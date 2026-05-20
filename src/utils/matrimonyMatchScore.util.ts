import type { MatrimonySection } from "../models/UserProfile.model";
import { STAR_ONE, STAR_TWO, type MatrimonyStarLevel } from "../constants/matrimony-monetization.constants";

function passesReverseAgePreference(
  candidateM: MatrimonySection,
  viewerAge: number | null
): boolean {
  if (viewerAge == null) return true;
  const min = candidateM.partnerAgeMin;
  const max = candidateM.partnerAgeMax;
  if (min != null && viewerAge < min) return false;
  if (max != null && viewerAge > max) return false;
  return true;
}

export type MatchScoreInput = {
  viewerDistrict: string | null;
  viewerAge: number | null;
  viewerM: MatrimonySection;
  candidateM?: MatrimonySection | null;
  candidate: {
    age: number | null;
    district: string | null;
    horoscopeAvailable: boolean;
    verified: boolean;
    kulamLabel: string | null;
    education: string | null;
    occupation: string | null;
  };
};

export type MatchScoreResult = {
  starLevel: MatrimonyStarLevel;
  matchTags: string[];
  score: number;
};

function ageInPartnerRange(
  age: number | null,
  min: number | null | undefined,
  max: number | null | undefined
): boolean {
  if (age == null) return false;
  if (min != null && age < min) return false;
  if (max != null && age > max) return false;
  return min != null || max != null;
}

export function computeMatrimonyMatchScore(input: MatchScoreInput): MatchScoreResult {
  const { viewerDistrict, viewerAge, viewerM, candidate } = input;
  const tags: string[] = [];
  let score = 0;

  if (candidate.verified) {
    score += 1;
    tags.push("Verified");
  }

  if (
    viewerDistrict &&
    candidate.district &&
    viewerDistrict.trim().toLowerCase() === candidate.district.trim().toLowerCase()
  ) {
    score += 2;
    tags.push("Same district");
  }

  if (ageInPartnerRange(candidate.age, viewerM.partnerAgeMin, viewerM.partnerAgeMax)) {
    score += 2;
    tags.push("Age match");
  }

  if (input.candidateM && viewerAge != null && passesReverseAgePreference(input.candidateM, viewerAge)) {
    score += 1;
    if (!tags.includes("Age match")) tags.push("Age match");
  }

  const kulam = candidate.kulamLabel ?? "";
  if (kulam && !kulam.toLowerCase().includes("same kulam")) {
    if (kulam.toLowerCase().includes("compatible")) {
      score += 2;
      tags.push("Kulam compatible");
    } else if (kulam) {
      score += 1;
    }
  }

  if (candidate.horoscopeAvailable) {
    score += 1;
    tags.push("Horoscope");
  }

  if (
    viewerM.education &&
    candidate.education &&
    viewerM.education.toLowerCase() === candidate.education.toLowerCase()
  ) {
    score += 1;
    tags.push("Education match");
  }

  if (
    viewerM.occupation &&
    candidate.occupation &&
    viewerM.occupation.toLowerCase() === candidate.occupation.toLowerCase()
  ) {
    score += 1;
    tags.push("Job match");
  }

  const starLevel: MatrimonyStarLevel = score >= 6 ? STAR_TWO : STAR_ONE;
  if (starLevel === STAR_TWO && !tags.includes("Strong match")) {
    tags.unshift("Strong match");
  }

  return { starLevel, matchTags: tags.slice(0, 6), score };
}

export function starLabel(level: MatrimonyStarLevel): string {
  return level === STAR_TWO ? "★★" : "★☆";
}
