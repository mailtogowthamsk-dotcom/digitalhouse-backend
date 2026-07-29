/**
 * Admin RBAC catalog + role resolution.
 * Phase 6: assignments live in admin_users (not admin-roles.json).
 * ADMIN_ROLES / MODULES / ACTIONS remain the master permission catalog.
 */
import {
  ADMIN_ACTIONS,
  ADMIN_ACTION_LABELS,
  ADMIN_MODULES,
  ADMIN_MODULE_LABELS,
  ADMIN_ROLE_LABELS,
  ADMIN_ROLES,
  getActionsForRole,
  getModulesForRole,
  isAdminRole,
  roleHasAction,
  roleHasModule,
  type AdminAction,
  type AdminModule,
  type AdminRole
} from "../constants/adminRoles.constants";
import { getCachedDbAccount, getCachedDbRole } from "./AdminUsers.service";

function whitelistEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS || "";
  return [
    ...new Set(raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean))
  ];
}

/**
 * Prefer admin_users role cache; else whitelist defaults (first email = SUPER_ADMIN).
 * JWT role claim is never used for authz (see admin.middleware).
 * null/empty email = API key path → role from ADMIN_API_KEY_ROLE (default SUPER_ADMIN).
 */
export function resolveApiKeyRole(): AdminRole {
  const raw = (process.env.ADMIN_API_KEY_ROLE || "SUPER_ADMIN").trim().toUpperCase();
  return isAdminRole(raw) ? raw : "SUPER_ADMIN";
}

export function resolveAdminRole(email: string | null | undefined): AdminRole {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return resolveApiKeyRole();
  const dbRole = getCachedDbRole(normalized);
  if (dbRole) return dbRole;
  const list = whitelistEmails();
  if (list.length > 0 && list[0] === normalized) return "SUPER_ADMIN";
  return "ADMIN";
}

/** Email is a known admin (DB cache and/or ADMIN_EMAILS whitelist). */
export function isKnownAdminEmail(email: string | null | undefined): boolean {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return false;
  if (getCachedDbAccount(normalized)) return true;
  return whitelistEmails().includes(normalized);
}

/** True when email is a known DB admin that has been deactivated. */
export function isDeactivatedDbAdmin(email: string | null | undefined): boolean {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return false;
  const acct = getCachedDbAccount(normalized);
  return Boolean(acct && !acct.isActive);
}

/**
 * Actions that require a human JWT session (adminEmail present), not API key —
 * unless ADMIN_API_KEY_ALLOW_ROLE_MANAGEMENT=true.
 */
export const API_KEY_RESTRICTED_ACTIONS: readonly AdminAction[] = [
  "settings.manage_roles"
];

const API_KEY_RESTRICTED_ACTION_SET: ReadonlySet<AdminAction> = new Set(
  API_KEY_RESTRICTED_ACTIONS
);

export function isApiKeyRestrictedAction(action: AdminAction): boolean {
  return API_KEY_RESTRICTED_ACTION_SET.has(action);
}

export function apiKeyAllowsRoleManagement(): boolean {
  const v = (process.env.ADMIN_API_KEY_ALLOW_ROLE_MANAGEMENT || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export type AdminAccountRow = {
  email: string;
  role: AdminRole;
  roleLabel: string;
  isDefaultSuper: boolean;
  name?: string | null;
  isActive?: boolean;
  lastLoginAt?: string | null;
  source: "database" | "whitelist";
};

/** Whitelist-only list (sync). Prefer listAdminAccountsMerged for Settings UI. */
export function listAdminAccounts(): Array<{
  email: string;
  role: AdminRole;
  roleLabel: string;
  isDefaultSuper: boolean;
}> {
  const list = whitelistEmails();
  return list.map((email, idx) => {
    const role = getCachedDbRole(email) ?? (idx === 0 ? "SUPER_ADMIN" : "ADMIN");
    return {
      email,
      role,
      roleLabel: ADMIN_ROLE_LABELS[role],
      isDefaultSuper: idx === 0 && !getCachedDbRole(email)
    };
  });
}

/** Merge admin_users + remaining whitelist-only emails for Settings overview. */
export async function listAdminAccountsMerged(): Promise<AdminAccountRow[]> {
  const list = whitelistEmails();
  const AdminUsers = await import("./AdminUsers.service");
  const dbUsers = await AdminUsers.listAdminUsers();
  const byEmail = new Map<string, AdminAccountRow>();

  for (let idx = 0; idx < list.length; idx++) {
    const email = list[idx];
    const role = getCachedDbRole(email) ?? (idx === 0 ? "SUPER_ADMIN" : "ADMIN");
    byEmail.set(email, {
      email,
      role,
      roleLabel: ADMIN_ROLE_LABELS[role],
      isDefaultSuper: idx === 0 && !getCachedDbRole(email),
      source: "whitelist"
    });
  }

  for (const u of dbUsers) {
    const existing = byEmail.get(u.email);
    byEmail.set(u.email, {
      email: u.email,
      role: u.role,
      roleLabel: u.roleLabel,
      isDefaultSuper: existing?.isDefaultSuper ?? false,
      name: u.name,
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt,
      source: "database"
    });
  }

  return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
}

export async function setAdminRole(
  targetEmail: string,
  role: AdminRole,
  actorEmail: string
): Promise<{ email: string; role: AdminRole; previousRole: AdminRole; changed: boolean }> {
  const normalized = targetEmail.trim().toLowerCase();
  const list = whitelistEmails();
  const AdminUsers = await import("./AdminUsers.service");
  const dbUser = await AdminUsers.findByEmail(normalized);

  if (!list.includes(normalized) && !dbUser) {
    throw Object.assign(
      new Error("Email is not in ADMIN_EMAILS whitelist and has no admin_users account"),
      { status: 400 }
    );
  }
  if (!isAdminRole(role)) {
    throw Object.assign(new Error("Invalid role"), { status: 400 });
  }

  const previousRole = resolveAdminRole(normalized);
  if (previousRole === role && dbUser) {
    return { email: normalized, role, previousRole, changed: false };
  }

  // Keep at least one active SUPER_ADMIN in admin_users after this change
  if (role !== "SUPER_ADMIN") {
    const others = await AdminUsers.countActiveSuperAdmins(normalized);
    const targetWasSuper =
      (dbUser?.role === "SUPER_ADMIN" && dbUser.isActive) ||
      (!dbUser && previousRole === "SUPER_ADMIN");
    if (targetWasSuper && others < 1) {
      throw Object.assign(new Error("At least one Super Admin is required"), { status: 400 });
    }
  }

  await AdminUsers.ensureDbAdminForAssignment({
    email: normalized,
    role,
    actorEmail
  });

  const changed = previousRole !== role;
  if (changed) {
    // Append-only audit via existing platform_audit_logs
    try {
      const { recordConfigChange } = await import("./PlatformConfigAudit.service");
      await recordConfigChange({
        action: "ADMIN_ROLE_CHANGED",
        auditModule: "settings",
        settingModule: "settings",
        setting: normalized,
        oldValue: previousRole,
        newValue: role,
        changedBy: actorEmail,
        meta: {
          adminUser: normalized,
          previousRole,
          newRole: role,
          changedBy: actorEmail,
          source: "database"
        }
      });
    } catch (e) {
      console.warn(
        "[admin-roles] role changed but audit log failed:",
        e instanceof Error ? e.message : e
      );
    }
  }

  return { email: normalized, role, previousRole, changed };
}

type PermissionMatrix = {
  roles: Array<{ code: AdminRole; label: string }>;
  modules: Array<{
    code: AdminModule;
    label: string;
    access: Record<AdminRole, boolean>;
  }>;
  actions: Array<{
    code: AdminAction;
    label: string;
    access: Record<AdminRole, boolean>;
  }>;
};

/** Static catalog matrix — computed once (roles/modules/actions never change at runtime). */
let permissionMatrixCache: PermissionMatrix | null = null;

export function getPermissionMatrix(): PermissionMatrix {
  if (permissionMatrixCache) return permissionMatrixCache;
  permissionMatrixCache = {
    roles: ADMIN_ROLES.map((code) => ({ code, label: ADMIN_ROLE_LABELS[code] })),
    modules: ADMIN_MODULES.map((code) => ({
      code,
      label: ADMIN_MODULE_LABELS[code],
      access: {
        SUPER_ADMIN: roleHasModule("SUPER_ADMIN", code),
        ADMIN: roleHasModule("ADMIN", code),
        MODERATOR: roleHasModule("MODERATOR", code)
      }
    })),
    actions: ADMIN_ACTIONS.map((code) => ({
      code,
      label: ADMIN_ACTION_LABELS[code],
      access: {
        SUPER_ADMIN: roleHasAction("SUPER_ADMIN", code),
        ADMIN: roleHasAction("ADMIN", code),
        MODERATOR: roleHasAction("MODERATOR", code)
      }
    }))
  };
  return permissionMatrixCache;
}

/** Lightweight session payload for GET /settings/me (avoids full settings overview). */
export function getSessionPermissions(actorEmail: string | null) {
  const role = resolveAdminRole(actorEmail);
  return {
    email: actorEmail,
    role,
    roleLabel: ADMIN_ROLE_LABELS[role],
    modules: [...getModulesForRole(role)],
    actions: [...getActionsForRole(role)]
  };
}

export async function getSettingsOverview(actorEmail: string | null) {
  const role = resolveAdminRole(actorEmail);
  const admins = await listAdminAccountsMerged();
  const dbCount = admins.filter((a) => a.source === "database").length;
  const AdminUsers = await import("./AdminUsers.service");
  const meta = await AdminUsers.getLatestRoleMeta();
  return {
    me: {
      email: actorEmail,
      role,
      roleLabel: ADMIN_ROLE_LABELS[role]
    },
    auth: {
      mode: (dbCount > 0 ? "database_assignments" : "shared_password_whitelist") as
        | "database_assignments"
        | "shared_password_whitelist",
      note:
        dbCount > 0
          ? "Role assignments are stored in admin_users. Login uses hashed passwords with lockout; API key role is configurable via ADMIN_API_KEY_ROLE (role changes require admin login unless overridden)."
          : "Admins are defined in ADMIN_EMAILS with a shared ADMIN_PASSWORD. Create individual admin accounts to move to hashed passwords and DB role assignments.",
      whitelistCount: whitelistEmails().length,
      databaseCount: dbCount,
      apiKeyRole: resolveApiKeyRole()
    },
    admins,
    matrix: getPermissionMatrix(),
    updatedAt: meta.updatedAt,
    updatedBy: meta.updatedBy
  };
}
