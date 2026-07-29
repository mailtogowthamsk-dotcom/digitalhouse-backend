/**
 * Legal document catalog defaults and status enums.
 * New document types can be added at runtime via admin (DB catalog);
 * these constants only seed the initial Digital House set.
 */

export const LEGAL_DOCUMENT_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type LegalDocumentStatus = (typeof LEGAL_DOCUMENT_STATUSES)[number];

export const LEGAL_CONTENT_FORMATS = ["html", "markdown"] as const;
export type LegalContentFormat = (typeof LEGAL_CONTENT_FORMATS)[number];

export const LEGAL_ACCEPTANCE_SOURCES = [
  "registration",
  "reacceptance",
  "settings",
  "admin"
] as const;
export type LegalAcceptanceSource = (typeof LEGAL_ACCEPTANCE_SOURCES)[number];

export const LEGAL_VERSION_BUMPS = ["minor", "major"] as const;
export type LegalVersionBump = (typeof LEGAL_VERSION_BUMPS)[number];

/** Built-in keys seeded for Digital House. Admins may add more later. */
export const LEGAL_DOCUMENT_KEYS = [
  "privacy_policy",
  "terms",
  "community_guidelines",
  "refund_policy",
  "content_policy",
  "account_deletion",
  "safety"
] as const;

export type LegalDocumentKey = (typeof LEGAL_DOCUMENT_KEYS)[number] | string;

export type LegalDocumentTypeSeed = {
  documentKey: string;
  title: string;
  slug: string;
  description: string;
  sortOrder: number;
  requiredAtRegistration: boolean;
  requiresReacceptance: boolean;
};

export const LEGAL_DOCUMENT_TYPE_SEEDS: LegalDocumentTypeSeed[] = [
  {
    documentKey: "privacy_policy",
    title: "Privacy Policy",
    slug: "privacy-policy",
    description: "How Digital House collects, uses, and protects personal information.",
    sortOrder: 10,
    requiredAtRegistration: true,
    requiresReacceptance: true
  },
  {
    documentKey: "terms",
    title: "Terms & Conditions",
    slug: "terms",
    description: "Rules for using Digital House community, chat, marketplace, and matrimony features.",
    sortOrder: 20,
    requiredAtRegistration: true,
    requiresReacceptance: true
  },
  {
    documentKey: "community_guidelines",
    title: "Community Guidelines",
    slug: "community-guidelines",
    description: "Expected conduct for posts, connections, chat, and community spaces.",
    sortOrder: 30,
    requiredAtRegistration: true,
    requiresReacceptance: false
  },
  {
    documentKey: "refund_policy",
    title: "Refund & Cancellation Policy",
    slug: "refund-policy",
    description: "Subscription and paid feature refunds and cancellations.",
    sortOrder: 40,
    requiredAtRegistration: false,
    requiresReacceptance: false
  },
  {
    documentKey: "content_policy",
    title: "Content Moderation Policy",
    slug: "content-policy",
    description: "How Digital House reviews, restricts, and removes user-generated content.",
    sortOrder: 50,
    requiredAtRegistration: false,
    requiresReacceptance: false
  },
  {
    documentKey: "account_deletion",
    title: "Account Deletion & Data Retention Policy",
    slug: "account-deletion",
    description: "How account deletion requests and data retention are handled.",
    sortOrder: 60,
    requiredAtRegistration: false,
    requiresReacceptance: false
  },
  {
    documentKey: "safety",
    title: "Safety & Abuse Reporting Policy",
    slug: "safety",
    description: "Safety tools, reporting, blocking, and escalation for abuse.",
    sortOrder: 70,
    requiredAtRegistration: false,
    requiresReacceptance: false
  }
];

/** Configurable identity used inside seeded legal HTML (not hardcoded into every screen). */
export const LEGAL_PLATFORM_DEFAULTS = {
  platformName: "Digital House",
  jurisdiction: "India",
  governingLaw: "the laws of India",
  supportEmail: "support@digitalhouse.app",
  privacyEmail: "privacy@digitalhouse.app",
  legalEmail: "legal@digitalhouse.app"
} as const;
