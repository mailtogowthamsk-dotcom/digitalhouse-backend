/** Admin-selectable correction areas → matrimony field keys */
export const MATRIMONY_CHANGE_SECTIONS = {
  profile_photo: {
    label: "Bride/groom photos",
    fields: ["candidatePhotoUrl", "profilePhotoUrl"]
  },
  kulam: {
    label: "Kulam / community",
    fields: ["kulamSnapshot", "gotra"]
  },
  horoscope: {
    label: "Horoscope document",
    fields: ["horoscopeDocumentUrl"]
  },
  about_me: {
    label: "About me",
    fields: ["aboutMe"]
  },
  family: {
    label: "Family details",
    fields: [
      "motherName",
      "fatherOccupation",
      "brothersCount",
      "sistersCount",
      "familyType",
      "familyStatus",
      "numberOfSiblings"
    ]
  },
  education_career: {
    label: "Education & career",
    fields: ["education", "occupation", "employer", "annualIncome"]
  },
  partner_preferences: {
    label: "Partner preferences",
    fields: [
      "partnerAgeMin",
      "partnerAgeMax",
      "preferredDistrictIds",
      "preferredKulamIds",
      "partnerPreferences",
      "partnerGenderPreference"
    ]
  }
} as const;

export type MatrimonyChangeSectionKey = keyof typeof MATRIMONY_CHANGE_SECTIONS;

export function fieldsForChangeSections(sectionKeys: string[]): string[] {
  const out = new Set<string>();
  for (const key of sectionKeys) {
    const def = MATRIMONY_CHANGE_SECTIONS[key as MatrimonyChangeSectionKey];
    if (def) def.fields.forEach((f) => out.add(f));
  }
  return [...out];
}

export function sectionLabel(key: string): string {
  return MATRIMONY_CHANGE_SECTIONS[key as MatrimonyChangeSectionKey]?.label ?? key;
}
