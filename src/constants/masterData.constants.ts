/**
 * Master Data Management — type codes and hierarchy.
 * Single source of truth for all selectable values across Digital House.
 */

export const MDM_TYPE_CODES = [
  "STATE",
  "DISTRICT",
  "TALUK",
  "TOWN",
  "VILLAGE",
  "PINCODE",
  "KULAM",
  "EDUCATION",
  "OCCUPATION",
  "BLOOD_GROUP",
  "MARITAL_STATUS",
  "LANGUAGE",
  "MARKETPLACE_CATEGORY",
  "HELP_CATEGORY"
] as const;

export type MdmTypeCode = (typeof MDM_TYPE_CODES)[number];

export type MdmTypeDefinition = {
  code: MdmTypeCode;
  name: string;
  description: string;
  /** Parent type for cascading selects; null = root. */
  parentTypeCode: MdmTypeCode | null;
  /** Allow creating items without parent even if parentType is set (rare). */
  parentOptional: boolean;
  isSystem: boolean;
};

export const MDM_TYPE_DEFINITIONS: MdmTypeDefinition[] = [
  {
    code: "STATE",
    name: "States",
    description: "Indian states / UTs",
    parentTypeCode: null,
    parentOptional: true,
    isSystem: true
  },
  {
    code: "DISTRICT",
    name: "Districts",
    description: "Districts under a state",
    parentTypeCode: "STATE",
    parentOptional: false,
    isSystem: true
  },
  {
    code: "TALUK",
    name: "Taluks",
    description: "Taluks under a district",
    parentTypeCode: "DISTRICT",
    parentOptional: false,
    isSystem: true
  },
  {
    code: "TOWN",
    name: "Cities / Towns",
    description: "Cities and towns under a district (taluk optional later)",
    parentTypeCode: "DISTRICT",
    parentOptional: false,
    isSystem: true
  },
  {
    code: "VILLAGE",
    name: "Villages",
    description: "Villages under a town (future-ready)",
    parentTypeCode: "TOWN",
    parentOptional: true,
    isSystem: true
  },
  {
    code: "PINCODE",
    name: "Pincodes",
    description: "Postal codes linked to a town",
    parentTypeCode: "TOWN",
    parentOptional: false,
    isSystem: true
  },
  {
    code: "KULAM",
    name: "Kulams",
    description: "Community kulam values",
    parentTypeCode: null,
    parentOptional: true,
    isSystem: true
  },
  {
    code: "EDUCATION",
    name: "Education",
    description: "Education levels",
    parentTypeCode: null,
    parentOptional: true,
    isSystem: true
  },
  {
    code: "OCCUPATION",
    name: "Occupations",
    description: "Occupation options",
    parentTypeCode: null,
    parentOptional: true,
    isSystem: true
  },
  {
    code: "BLOOD_GROUP",
    name: "Blood Groups",
    description: "Blood group options",
    parentTypeCode: null,
    parentOptional: true,
    isSystem: true
  },
  {
    code: "MARITAL_STATUS",
    name: "Marital Status",
    description: "Marital status options",
    parentTypeCode: null,
    parentOptional: true,
    isSystem: true
  },
  {
    code: "LANGUAGE",
    name: "Languages",
    description: "Languages / mother tongue",
    parentTypeCode: null,
    parentOptional: true,
    isSystem: true
  },
  {
    code: "MARKETPLACE_CATEGORY",
    name: "Marketplace Categories",
    description: "Marketplace listing categories",
    parentTypeCode: null,
    parentOptional: true,
    isSystem: true
  },
  {
    code: "HELP_CATEGORY",
    name: "Helping Hands Categories",
    description: "Help request categories",
    parentTypeCode: null,
    parentOptional: true,
    isSystem: true
  }
];

export const MDM_CACHE_TTL_MS = 5 * 60 * 1000;
export const MDM_LABEL_MAX = 160;
export const MDM_CODE_MAX = 64;
