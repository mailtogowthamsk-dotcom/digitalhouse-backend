import fs from "fs";
import path from "path";
import {
  ADMIN_ACTIONS,
  ADMIN_ACTION_LABELS,
  ADMIN_MODULES,
  ADMIN_MODULE_LABELS,
  ADMIN_ROLE_LABELS,
  ADMIN_ROLES,
  ROLE_ACTION_ACCESS,
  ROLE_MODULE_ACCESS,
  isAdminRole,
  type AdminAction,
  type AdminModule,
  type AdminRole
} from "../constants/adminRoles.constants";

type RolesFile = {
  updatedAt?: string;
  updatedBy?: string | null;
  /** email (lowercase) → role */
  assignments: Record<string, AdminRole>;
};

const ROLES_PATH = path.join(__dirname, "../../data/admin-roles.json");

let cache: RolesFile | null = null;
let cacheMtime = 0;

function whitelistEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS || "";
  return [
    ...new Set(raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean))
  ];
}

function readFile(): RolesFile {
  try {
    if (!fs.existsSync(ROLES_PATH)) {
      return { assignments: {} };
    }
    const stat = fs.statSync(ROLES_PATH);
    if (cache && stat.mtimeMs === cacheMtime) return cache;
    const parsed = JSON.parse(fs.readFileSync(ROLES_PATH, "utf8")) as RolesFile;
    const assignments: Record<string, AdminRole> = {};
    for (const [email, role] of Object.entries(parsed.assignments || {})) {
      const key = email.trim().toLowerCase();
      if (key && isAdminRole(String(role))) assignments[key] = role;
    }
    cache = {
      updatedAt: parsed.updatedAt,
      updatedBy: parsed.updatedBy ?? null,
      assignments
    };
    cacheMtime = stat.mtimeMs;
    return cache;
  } catch {
    return { assignments: {} };
  }
}

function writeFile(data: RolesFile): void {
  const dir = path.dirname(ROLES_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ROLES_PATH, JSON.stringify(data, null, 2), "utf8");
  cache = data;
  try {
    cacheMtime = fs.statSync(ROLES_PATH).mtimeMs;
  } catch {
    cacheMtime = Date.now();
  }
}

/** First whitelist email defaults to SUPER_ADMIN; others default to ADMIN. */
export function resolveAdminRole(email: string | null | undefined): AdminRole {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return "SUPER_ADMIN"; // API key access = full power
  const file = readFile();
  if (file.assignments[normalized]) return file.assignments[normalized];
  const list = whitelistEmails();
  if (list.length > 0 && list[0] === normalized) return "SUPER_ADMIN";
  return "ADMIN";
}

export function listAdminAccounts(): Array<{
  email: string;
  role: AdminRole;
  roleLabel: string;
  isDefaultSuper: boolean;
}> {
  const file = readFile();
  const list = whitelistEmails();
  return list.map((email, idx) => {
    const role = file.assignments[email] ?? (idx === 0 ? "SUPER_ADMIN" : "ADMIN");
    return {
      email,
      role,
      roleLabel: ADMIN_ROLE_LABELS[role],
      isDefaultSuper: idx === 0 && !file.assignments[email]
    };
  });
}

export function setAdminRole(
  targetEmail: string,
  role: AdminRole,
  actorEmail: string
): { email: string; role: AdminRole } {
  const normalized = targetEmail.trim().toLowerCase();
  const list = whitelistEmails();
  if (!list.includes(normalized)) {
    throw Object.assign(new Error("Email is not in ADMIN_EMAILS whitelist"), { status: 400 });
  }
  if (!isAdminRole(role)) {
    throw Object.assign(new Error("Invalid role"), { status: 400 });
  }

  const file = readFile();
  const next: RolesFile = {
    updatedAt: new Date().toISOString(),
    updatedBy: actorEmail,
    assignments: { ...file.assignments, [normalized]: role }
  };

  // Keep at least one SUPER_ADMIN among whitelist
  const projected = list.map((email) =>
    email === normalized ? role : next.assignments[email] ?? (email === list[0] ? "SUPER_ADMIN" : "ADMIN")
  );
  if (!projected.includes("SUPER_ADMIN")) {
    throw Object.assign(new Error("At least one Super Admin is required"), { status: 400 });
  }

  writeFile(next);
  return { email: normalized, role };
}

export function getPermissionMatrix(): {
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
} {
  return {
    roles: ADMIN_ROLES.map((code) => ({ code, label: ADMIN_ROLE_LABELS[code] })),
    modules: ADMIN_MODULES.map((code) => ({
      code,
      label: ADMIN_MODULE_LABELS[code],
      access: {
        SUPER_ADMIN: ROLE_MODULE_ACCESS.SUPER_ADMIN.includes(code),
        ADMIN: ROLE_MODULE_ACCESS.ADMIN.includes(code),
        MODERATOR: ROLE_MODULE_ACCESS.MODERATOR.includes(code)
      }
    })),
    actions: ADMIN_ACTIONS.map((code) => ({
      code,
      label: ADMIN_ACTION_LABELS[code],
      access: {
        SUPER_ADMIN: ROLE_ACTION_ACCESS.SUPER_ADMIN.includes(code),
        ADMIN: ROLE_ACTION_ACCESS.ADMIN.includes(code),
        MODERATOR: ROLE_ACTION_ACCESS.MODERATOR.includes(code)
      }
    }))
  };
}

export function getSettingsOverview(actorEmail: string | null) {
  const role = resolveAdminRole(actorEmail);
  return {
    me: {
      email: actorEmail,
      role,
      roleLabel: ADMIN_ROLE_LABELS[role]
    },
    auth: {
      mode: "shared_password_whitelist" as const,
      note: "Admins are defined in ADMIN_EMAILS with a shared ADMIN_PASSWORD. Roles are assigned below and stored in admin-roles.json.",
      whitelistCount: whitelistEmails().length
    },
    admins: listAdminAccounts(),
    matrix: getPermissionMatrix(),
    updatedAt: readFile().updatedAt ?? null,
    updatedBy: readFile().updatedBy ?? null
  };
}
