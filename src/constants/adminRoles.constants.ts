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
  settings: "Settings & Roles"
};

/** Fine-grained actions beyond module access */
export const ADMIN_ACTIONS = [
  "users.approve",
  "users.suspend",
  "reports.warn",
  "reports.suspend",
  "reports.escalate",
  "settings.manage_roles",
  "master_data.write",
  "prominent_people.write",
  "notifications.broadcast"
] as const;

export type AdminAction = (typeof ADMIN_ACTIONS)[number];

export const ADMIN_ACTION_LABELS: Record<AdminAction, string> = {
  "users.approve": "Approve / reject users",
  "users.suspend": "Suspend / reactivate users",
  "reports.warn": "Warn reported users",
  "reports.suspend": "Suspend from reports",
  "reports.escalate": "Escalate reports",
  "settings.manage_roles": "Assign admin roles",
  "master_data.write": "Create / edit master data",
  "prominent_people.write": "Create / edit Prominent People",
  "notifications.broadcast": "Broadcast notifications"
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
  "settings"
];

export const ROLE_MODULE_ACCESS: Record<AdminRole, readonly AdminModule[]> = {
  SUPER_ADMIN: ALL_MODULES,
  ADMIN: ALL_MODULES,
  MODERATOR: MODERATOR_MODULES
};

export const ROLE_ACTION_ACCESS: Record<AdminRole, readonly AdminAction[]> = {
  SUPER_ADMIN: [...ADMIN_ACTIONS],
  ADMIN: [
    "users.approve",
    "users.suspend",
    "reports.warn",
    "reports.suspend",
    "reports.escalate",
    "master_data.write",
    "prominent_people.write",
    "notifications.broadcast"
  ],
  MODERATOR: ["reports.warn"]
};

export function roleHasModule(role: AdminRole, module: AdminModule): boolean {
  return ROLE_MODULE_ACCESS[role].includes(module);
}

export function roleHasAction(role: AdminRole, action: AdminAction): boolean {
  return ROLE_ACTION_ACCESS[role].includes(action);
}

export function isAdminRole(value: string): value is AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(value);
}
