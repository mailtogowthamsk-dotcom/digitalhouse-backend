/** Help & Support — ticket types, categories, statuses */

export const SUPPORT_TICKET_TYPES = [
  "BUG",
  "FEATURE",
  "QUESTION",
  "CONTACT",
  "GENERAL"
] as const;
export type SupportTicketType = (typeof SUPPORT_TICKET_TYPES)[number];

export const SUPPORT_BUG_CATEGORIES = [
  "LOGIN",
  "FEED",
  "CHAT",
  "MATRIMONY",
  "MARKETPLACE",
  "JOBS",
  "PAYMENTS",
  "NOTIFICATIONS",
  "OTHER"
] as const;
export type SupportBugCategory = (typeof SUPPORT_BUG_CATEGORIES)[number];

export const SUPPORT_TICKET_STATUSES = [
  "OPEN",
  "UNDER_REVIEW",
  "IN_PROGRESS",
  "PLANNED",
  "ACCEPTED",
  "REJECTED",
  "RESOLVED",
  "RELEASED",
  "CLOSED"
] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

export const SUPPORT_PRIORITIES = ["LOW", "NORMAL", "HIGH"] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

export const SUPPORT_BUG_CATEGORY_LABELS: Record<SupportBugCategory, string> = {
  LOGIN: "Login",
  FEED: "Feed",
  CHAT: "Chat",
  MATRIMONY: "Matrimony",
  MARKETPLACE: "Marketplace",
  JOBS: "Jobs",
  PAYMENTS: "Payments",
  NOTIFICATIONS: "Notifications",
  OTHER: "Other"
};

export const SUPPORT_TICKET_TYPE_LABELS: Record<SupportTicketType, string> = {
  BUG: "Bug report",
  FEATURE: "Feature request",
  QUESTION: "Question",
  CONTACT: "Contact admin",
  GENERAL: "General"
};

export const SUPPORT_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  OPEN: "Open",
  UNDER_REVIEW: "Under review",
  IN_PROGRESS: "In progress",
  PLANNED: "Planned",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  RESOLVED: "Resolved",
  RELEASED: "Released",
  CLOSED: "Closed"
};

export const DEFAULT_SUPPORT_FAQS: Array<{
  question: string;
  answer: string;
  category: string;
  sortOrder: number;
}> = [
  {
    category: "Account",
    sortOrder: 1,
    question: "When will my account be approved?",
    answer:
      "New registrations are reviewed by community admins, usually within 1–2 business days. You will get a notification and email once approved."
  },
  {
    category: "Feed",
    sortOrder: 2,
    question: "How do I create a post?",
    answer:
      "From Home, tap the + / Create button. Choose a feed category (Announcement, Meetup, Achievement, or Entertainment), add a title and optional description/photo, then publish."
  },
  {
    category: "Matrimony",
    sortOrder: 3,
    question: "How do I register for Matrimony?",
    answer:
      "Open Matrimony from the menu, complete your matrimony profile, and submit for admin review. Messaging unlocks after a verified match or connection as per community rules."
  },
  {
    category: "Chat",
    sortOrder: 4,
    question: "Why can't I message someone?",
    answer:
      "Messaging requires a connection (or an approved matrimony match for matrimony chat). Send a connection request from Find Members. Blocked or pending accounts cannot message."
  },
  {
    category: "Payments",
    sortOrder: 5,
    question: "How do I subscribe?",
    answer:
      "Open Matrimony → Plans (or Subscription) to view packages and pay securely. If payment succeeds but benefits are missing, raise a Contact Admin ticket with the order ID."
  },
  {
    category: "Account",
    sortOrder: 6,
    question: "How do I delete my account?",
    answer:
      "Contact support via Help & Support → Contact Support or raise a Contact Admin ticket requesting account deletion. An admin will confirm and process your request."
  }
];

export const DEFAULT_SUPPORT_GUIDES: Array<{
  title: string;
  summary: string;
  sortOrder: number;
  steps: Array<{ title: string; body: string; sortOrder: number }>;
}> = [
  {
    title: "Create a post",
    summary: "Share an announcement or community update on the Home Feed.",
    sortOrder: 1,
    steps: [
      {
        sortOrder: 1,
        title: "Open Create",
        body: "On Home, tap the create (+) action to open the Create Post screen."
      },
      {
        sortOrder: 2,
        title: "Choose a category",
        body: "Pick Announcement, Community meetup, Achievements, or Entertainment."
      },
      {
        sortOrder: 3,
        title: "Add title & publish",
        body: "Write a clear title, optional description and photo, then submit."
      }
    ]
  },
  {
    title: "Send a connection request",
    summary: "Connect with another approved member so you can message them.",
    sortOrder: 2,
    steps: [
      {
        sortOrder: 1,
        title: "Find Members",
        body: "Open Menu → Find Members and search by name or @username."
      },
      {
        sortOrder: 2,
        title: "Open their profile",
        body: "Tap the member, then tap Connect (if they accept requests)."
      },
      {
        sortOrder: 3,
        title: "Wait for acceptance",
        body: "Once accepted, you can message them from Messages."
      }
    ]
  }
];
