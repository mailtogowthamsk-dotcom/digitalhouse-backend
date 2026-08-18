/** Admin panel roles and module permissions */

export const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "MODERATOR"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  MODERATOR: "Moderator"
};

/** Sidebar / feature modules used for the permission matrix */
export const ADMIN_MODULES = [
  "dashboard",
  "users",
  "matrimony",
  "matrimony_reports",
  "matrimony_subscriptions",
  "business",
  "posts",
  "jobs",
  "marketplace",
  "helping_hands",
  "master_data",
  "community_content",
  "prominent_people",
  "reports",
  "support",
  "notifications",
  "platform",
  "advertisements",
  "system_scheduler",
  "settings"
] as const;

export type AdminModule = (typeof ADMIN_MODULES)[number];

export const ADMIN_MODULE_LABELS: Record<AdminModule, string> = {
  dashboard: "Dashboard",
  users: "User Management",
  matrimony: "Matrimony Requests",
  matrimony_reports: "Matrimony Reports",
  matrimony_subscriptions: "Subscriptions & Revenue",
  business: "Business Approval",
  posts: "Posts Moderation",
  jobs: "Job Portal",
  marketplace: "Marketplace",
  helping_hands: "Helping Hand",
  master_data: "Master Data",
  community_content: "Community Content",
  prominent_people: "Prominent People",
  reports: "Reports & Complaints",
  support: "Help & Support",
  notifications: "Notifications",
  platform: "Platform Management",
  advertisements: "Advertisements",
  system_scheduler: "System Scheduler",
  settings: "Settings & Roles"
};

/**
 * Fine-grained actions beyond module access.
 * Extend this catalog only — do not remove existing keys (backward compatible).
 */
export const ADMIN_ACTIONS = [
  "jobs.manage",
  "jobs.delete_hard",
  "marketplace.manage",
  "marketplace.delete_hard",
  "users.approve",
  "users.suspend",
  "users.edit",
  "users.delete",
  "reports.warn",
  "reports.suspend",
  "reports.escalate",
  "reports.manage",
  "settings.manage_roles",
  "settings.legal_manage",
  "master_data.write",
  "prominent_people.write",
  "notifications.broadcast",
  "posts.manage",
  "posts.delete_hard",
  "matrimony.manage",
  "matrimony_subscriptions.manage",
  "matrimony_subscriptions.grant",
  "matrimony_subscriptions.refund",
  "matrimony_subscriptions.export",
  "helping_hands.manage",
  "support.write",
  "business.approve",
  "platform.manage",
  "platform.maintenance",
  "platform.versions",
  "platform.features",
  "system_scheduler.manage",
  "advertisements.manage",
  "advertisements.refund",
  "advertisements.pricing"
] as const;

export type AdminAction = (typeof ADMIN_ACTIONS)[number];

export const ADMIN_ACTION_LABELS: Record<AdminAction, string> = {
  "users.approve": "Approve / reject users",
  "users.suspend": "Suspend / reactivate / log out users",
  "users.edit": "Edit user profiles",
  "users.delete": "Soft / hard delete users",
  "jobs.manage": "Manage jobs and applications",
  "jobs.delete_hard": "Permanently delete jobs",
  "marketplace.manage": "Manage marketplace listings",
  "marketplace.delete_hard": "Permanently delete marketplace listings",
  "reports.warn": "Warn reported users",
  "reports.suspend": "Suspend from reports",
  "reports.escalate": "Escalate reports",
  "reports.manage": "Resolve / dismiss reports",
  "settings.manage_roles": "Assign admin roles",
  "settings.legal_manage": "Manage legal documents",
  "master_data.write": "Create / edit master data",
  "prominent_people.write": "Create / edit Prominent People",
  "notifications.broadcast": "Broadcast notifications",
  "posts.manage": "Moderate posts (hide / restore / edit)",
  "posts.delete_hard": "Permanently delete posts",
  "matrimony.manage": "Manage matrimony requests",
  "matrimony_subscriptions.manage": "Manage subscriptions",
  "matrimony_subscriptions.grant": "Grant complimentary subscriptions",
  "matrimony_subscriptions.refund": "Record subscription refunds",
  "matrimony_subscriptions.export": "Export subscriptions / revenue",
  "helping_hands.manage": "Manage helping-hand requests",
  "support.write": "Create / edit support content",
  "business.approve": "Approve business profile updates",
  "platform.manage": "Manage platform content & settings",
  "platform.maintenance": "Toggle maintenance mode",
  "platform.versions": "Manage app versions",
  "platform.features": "Toggle feature flags / menu",
  "system_scheduler.manage": "Enable / disable / run scheduled jobs",
  "advertisements.manage": "Review, approve, pause, and manage advertisements",
  "advertisements.refund": "Refund advertisement payments",
  "advertisements.pricing": "Manage advertisement pricing and durations"
};

const ALL_MODULES = [...ADMIN_MODULES];

const MODERATOR_MODULES: AdminModule[] = [
  "dashboard",
  "posts",
  "jobs",
  "marketplace",
  "helping_hands",
  "reports",
  "support",
  "matrimony_reports",
  "community_content",
  "advertisements",
  "settings"
];

export const ROLE_MODULE_ACCESS: Record<AdminRole, readonly AdminModule[]> = {
  SUPER_ADMIN: ALL_MODULES,
  ADMIN: ALL_MODULES,
  MODERATOR: MODERATOR_MODULES
};

/** ADMIN gets most actions; hard-deletes + role assignment remain Super Admin. */
const ADMIN_ROLE_ACTIONS: AdminAction[] = [
  "users.approve",
  "users.suspend",
  "users.edit",
  "users.delete",
  "jobs.manage",
  "marketplace.manage",
  "reports.warn",
  "reports.suspend",
  "reports.escalate",
  "reports.manage",
  "master_data.write",
  "prominent_people.write",
  "notifications.broadcast",
  "posts.manage",
  "matrimony.manage",
  "matrimony_subscriptions.manage",
  "matrimony_subscriptions.grant",
  "matrimony_subscriptions.refund",
  "matrimony_subscriptions.export",
  "helping_hands.manage",
  "support.write",
  "business.approve",
  "platform.manage",
  "platform.maintenance",
  "platform.versions",
  "platform.features",
  "system_scheduler.manage",
  "settings.legal_manage",
  "advertisements.manage",
  "advertisements.refund",
  "advertisements.pricing"
];

const MODERATOR_ROLE_ACTIONS: AdminAction[] = [
  "reports.warn",
  "reports.manage",
  "jobs.manage",
  "marketplace.manage",
  "posts.manage",
  "helping_hands.manage",
  "support.write",
  "advertisements.manage"
];

export const ROLE_ACTION_ACCESS: Record<AdminRole, readonly AdminAction[]> = {
  SUPER_ADMIN: [...ADMIN_ACTIONS],
  ADMIN: ADMIN_ROLE_ACTIONS,
  MODERATOR: MODERATOR_ROLE_ACTIONS
};

/** O(1) membership — built once from ROLE_*_ACCESS arrays. */
const ROLE_MODULE_SET: Record<AdminRole, ReadonlySet<AdminModule>> = {
  SUPER_ADMIN: new Set(ROLE_MODULE_ACCESS.SUPER_ADMIN),
  ADMIN: new Set(ROLE_MODULE_ACCESS.ADMIN),
  MODERATOR: new Set(ROLE_MODULE_ACCESS.MODERATOR)
};

const ROLE_ACTION_SET: Record<AdminRole, ReadonlySet<AdminAction>> = {
  SUPER_ADMIN: new Set(ROLE_ACTION_ACCESS.SUPER_ADMIN),
  ADMIN: new Set(ROLE_ACTION_ACCESS.ADMIN),
  MODERATOR: new Set(ROLE_ACTION_ACCESS.MODERATOR)
};

const ADMIN_ROLE_SET: ReadonlySet<string> = new Set(ADMIN_ROLES);

export function roleHasModule(role: AdminRole, module: AdminModule): boolean {
  return ROLE_MODULE_SET[role]?.has(module) ?? false;
}

export function roleHasAction(role: AdminRole, action: AdminAction): boolean {
  return ROLE_ACTION_SET[role]?.has(action) ?? false;
}

export function isAdminRole(value: string): value is AdminRole {
  return ADMIN_ROLE_SET.has(value);
}

/** Modules granted to a role (stable array; do not mutate). */
export function getModulesForRole(role: AdminRole): readonly AdminModule[] {
  return ROLE_MODULE_ACCESS[role] ?? [];
}

/** Actions granted to a role (stable array; do not mutate). */
export function getActionsForRole(role: AdminRole): readonly AdminAction[] {
  return ROLE_ACTION_ACCESS[role] ?? [];
}
