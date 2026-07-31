import { MATRIMONY_REQUIRED_KEYS } from "../../src/constants/matrimony.constants";

/** Build a matrimony section that satisfies all required keys for completion tests. */
export function buildCompleteMatrimonySection(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    matrimonyProfileActive: true,
    lookingFor: "SELF",
    partnerGenderPreference: "FEMALE",
    height: "5'8\"",
    complexion: "Fair",
    motherTongue: "Tamil",
    aboutMe: "About me text for testing.",
    gotra: "Test Gotra",
    education: "BE",
    occupation: "Engineer",
    employer: "Acme",
    annualIncome: "LAKHS_10_15",
    maritalStatus: "Never Married",
    rashi: "Mesha",
    nakshatram: "Ashwini",
    dosham: "None",
    motherName: "Mother",
    fatherName: "Father",
    fatherOccupation: "Business",
    brothersCount: 0,
    sistersCount: 1,
    familyType: "Nuclear",
    partnerAgeMin: 24,
    partnerAgeMax: 32,
    preferredDistrictIds: [1, 2],
    preferredKulamIds: [1],
    candidatePhotoUrl: "digital-house/matrimony/1/candidate.jpg",
    horoscopeDocumentUrl: "digital-house/private/matrimony/1/horoscope.pdf"
  };

  // Ensure every declared required key has a value
  for (const key of MATRIMONY_REQUIRED_KEYS) {
    if (base[key] === undefined) {
      base[key] = typeof key === "string" && key.endsWith("Count") ? 0 : "x";
    }
  }

  return { ...base, ...overrides };
}
