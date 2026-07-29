/**
 * Individual admin accounts (admin_users).
 * Extends Settings & Roles — does not replace ADMIN_ROLES catalog or whitelist fallback.
 */
import { AdminUser } from "../models/AdminUser.model";
import {
  ADMIN_ROLE_LABELS,
  isAdminRole,
  type AdminRole
} from "../constants/adminRoles.constants";
import { hashPassword, verifyPassword } from "../utils/adminPassword.util";

/** Sync account cache for resolveAdminRole / inactive checks (middleware is sync). */
type CachedAccount = { role: AdminRole; isActive: boolean };
const accountCache = new Map<string, CachedAccount>();
let tablesReady: boolean | null = null;

export type AdminUserPublic = {
  id: number;
  name: string;
  email: string;
  role: AdminRole;
  roleLabel: string;
  isActive: boolean;
  lastLoginAt: string | null;
  failedLoginCount: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  source: "database";
};

function toPublic(row: AdminUser): AdminUserPublic {
  const role = (isAdminRole(row.role) ? row.role : "ADMIN") as AdminRole;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role,
    roleLabel: ADMIN_ROLE_LABELS[role],
    isActive: row.isActive,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    failedLoginCount: row.failedLoginCount,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    source: "database"
  };
}

export async function ensureAdminUsersTable(): Promise<boolean> {
  if (tablesReady === true) return true;
  try {
    await AdminUser.findOne({ limit: 1 });
    tablesReady = true;
    await warmRoleCache();
    return true;
  } catch {
    // Do not permanently cache failure — table may be created after boot.
    return false;
  }
}

async function warmRoleCache(): Promise<void> {
  try {
    const rows = await AdminUser.findAll({ attributes: ["email", "role", "isActive"] });
    accountCache.clear();
    for (const row of rows) {
      if (!isAdminRole(row.role)) continue;
      accountCache.set(row.email.toLowerCase(), {
        role: row.role as AdminRole,
        isActive: row.isActive
      });
    }
  } catch {
    /* ignore */
  }
}

/** Sync lookup used by AdminRoles.resolveAdminRole (role even if inactive). */
export function getCachedDbRole(email: string): AdminRole | null {
  return getCachedDbAccount(email)?.role ?? null;
}

export function getCachedDbAccount(email: string): CachedAccount | null {
  const key = email.trim().toLowerCase();
  return accountCache.get(key) ?? null;
}

function setCache(email: string, role: AdminRole | null, active: boolean): void {
  const key = email.trim().toLowerCase();
  if (!role) {
    accountCache.delete(key);
    return;
  }
  accountCache.set(key, { role, isActive: active });
}

export async function findByEmail(email: string): Promise<AdminUser | null> {
  if (!(await ensureAdminUsersTable())) return null;
  return AdminUser.findOne({ where: { email: email.trim().toLowerCase() } });
}

export async function listAdminUsers(): Promise<AdminUserPublic[]> {
  if (!(await ensureAdminUsersTable())) return [];
  const rows = await AdminUser.findAll({ order: [["email", "ASC"]] });
  return rows.map(toPublic);
}

export async function createAdminUser(input: {
  name: string;
  email: string;
  password: string;
  role: AdminRole;
  actorEmail: string | null;
}): Promise<AdminUserPublic> {
  if (!(await ensureAdminUsersTable())) {
    throw Object.assign(new Error("admin_users table missing. Run db:run-admin-users-sql"), {
      status: 503
    });
  }
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!name || name.length < 2) {
    throw Object.assign(new Error("Name is required"), { status: 400 });
  }
  if (!email || !email.includes("@")) {
    throw Object.assign(new Error("Valid email is required"), { status: 400 });
  }
  if (!input.password || input.password.length < 8) {
    throw Object.assign(new Error("Password must be at least 8 characters"), { status: 400 });
  }
  if (!isAdminRole(input.role)) {
    throw Object.assign(new Error("Invalid role"), { status: 400 });
  }
  const existing = await AdminUser.findOne({ where: { email } });
  if (existing) {
    throw Object.assign(new Error("An admin with this email already exists"), { status: 409 });
  }
  const now = new Date();
  const row = await AdminUser.create({
    name,
    email,
    passwordHash: await hashPassword(input.password),
    role: input.role,
    isActive: true,
    lastLoginAt: null,
    failedLoginCount: 0,
    createdBy: input.actorEmail,
    updatedBy: input.actorEmail,
    createdAt: now,
    updatedAt: now
  } as any);
  setCache(email, input.role, true);
  return toPublic(row);
}

export async function updateAdminUser(
  email: string,
  patch: {
    name?: string;
    role?: AdminRole;
    isActive?: boolean;
    password?: string;
  },
  actorEmail: string | null
): Promise<AdminUserPublic> {
  if (!(await ensureAdminUsersTable())) {
    throw Object.assign(new Error("admin_users table missing. Run db:run-admin-users-sql"), {
      status: 503
    });
  }
  const normalized = email.trim().toLowerCase();
  const row = await AdminUser.findOne({ where: { email: normalized } });
  if (!row) {
    throw Object.assign(new Error("Admin user not found"), { status: 404 });
  }

  const updates: Partial<AdminUser> = { updatedBy: actorEmail ?? null, updatedAt: new Date() };
  if (typeof patch.name === "string" && patch.name.trim()) updates.name = patch.name.trim();
  if (patch.role && isAdminRole(patch.role)) updates.role = patch.role;
  if (typeof patch.isActive === "boolean") updates.isActive = patch.isActive;
  if (typeof patch.password === "string" && patch.password.length > 0) {
    if (patch.password.length < 8) {
      throw Object.assign(new Error("Password must be at least 8 characters"), { status: 400 });
    }
    updates.passwordHash = await hashPassword(patch.password);
    updates.failedLoginCount = 0;
  }

  const nextActive = updates.isActive ?? row.isActive;
  const nextRole = (updates.role as AdminRole | undefined) ?? (row.role as AdminRole);
  if (
    row.role === "SUPER_ADMIN" &&
    row.isActive &&
    (nextActive === false || nextRole !== "SUPER_ADMIN")
  ) {
    const others = await countActiveSuperAdmins(normalized);
    if (others < 1) {
      throw Object.assign(new Error("At least one active Super Admin is required"), {
        status: 400
      });
    }
  }

  await row.update(updates as any);
  await row.reload();
  setCache(normalized, row.role as AdminRole, row.isActive);
  return toPublic(row);
}

export type DbLoginResult =
  | { ok: true; email: string; name: string; role: AdminRole }
  | { ok: false; reason: "not_found" | "inactive" | "bad_password" | "locked" };

const MAX_FAILED_LOGINS = Number(process.env.ADMIN_MAX_FAILED_LOGINS || 5);
const LOCKOUT_MS = Number(process.env.ADMIN_LOCKOUT_MS || 15 * 60 * 1000);

/** Attempt login against admin_users. not_found → caller may use legacy whitelist. */
export async function tryDatabaseLogin(
  email: string,
  password: string
): Promise<DbLoginResult> {
  if (!(await ensureAdminUsersTable())) return { ok: false, reason: "not_found" };
  const normalized = email.trim().toLowerCase();
  const row = await AdminUser.findOne({ where: { email: normalized } });
  if (!row) return { ok: false, reason: "not_found" };
  if (!row.isActive) return { ok: false, reason: "inactive" };

  const maxFails = Number.isFinite(MAX_FAILED_LOGINS) && MAX_FAILED_LOGINS > 0 ? MAX_FAILED_LOGINS : 5;
  const lockMs = Number.isFinite(LOCKOUT_MS) && LOCKOUT_MS > 0 ? LOCKOUT_MS : 15 * 60 * 1000;
  if (row.failedLoginCount >= maxFails) {
    const elapsed = Date.now() - new Date(row.updatedAt).getTime();
    if (elapsed < lockMs) {
      return { ok: false, reason: "locked" };
    }
  }

  const valid = await verifyPassword(password, row.passwordHash);
  if (!valid) {
    await row.update({
      failedLoginCount: row.failedLoginCount + 1,
      updatedAt: new Date()
    } as any);
    return { ok: false, reason: "bad_password" };
  }

  const role = (isAdminRole(row.role) ? row.role : "ADMIN") as AdminRole;
  await row.update({
    lastLoginAt: new Date(),
    failedLoginCount: 0,
    updatedAt: new Date()
  } as any);
  setCache(normalized, role, true);
  return { ok: true, email: normalized, name: row.name, role };
}

/**
 * After successful legacy whitelist login, upsert an admin_users row so the account
 * can migrate off the shared password (idempotent if already present).
 */
export async function provisionFromLegacyLogin(input: {
  email: string;
  password: string;
  role: AdminRole;
}): Promise<void> {
  if (!(await ensureAdminUsersTable())) return;
  const email = input.email.trim().toLowerCase();
  const existing = await AdminUser.findOne({ where: { email } });
  if (existing) {
    // Keep existing hash; only refresh last login
    await existing.update({
      lastLoginAt: new Date(),
      failedLoginCount: 0,
      updatedAt: new Date()
    } as any);
    setCache(email, existing.role as AdminRole, existing.isActive);
    return;
  }
  const name = email.split("@")[0] || email;
  const now = new Date();
  await AdminUser.create({
    name,
    email,
    passwordHash: await hashPassword(input.password),
    role: input.role,
    isActive: true,
    lastLoginAt: now,
    failedLoginCount: 0,
    createdBy: "legacy_login",
    updatedBy: "legacy_login",
    createdAt: now,
    updatedAt: now
  } as any);
  setCache(email, input.role, true);
}

export async function syncRoleToDatabase(
  email: string,
  role: AdminRole,
  actorEmail: string | null
): Promise<AdminUserPublic | null> {
  if (!(await ensureAdminUsersTable())) return null;
  const normalized = email.trim().toLowerCase();
  const row = await AdminUser.findOne({ where: { email: normalized } });
  if (!row) return null;
  await row.update({
    role,
    updatedBy: actorEmail,
    updatedAt: new Date()
  } as any);
  await row.reload();
  setCache(normalized, role, row.isActive);
  return toPublic(row);
}

/**
 * Ensure an admin_users row exists for role assignment (Phase 6).
 * Whitelist emails without a row are provisioned using the shared ADMIN_PASSWORD when set.
 */
export async function ensureDbAdminForAssignment(input: {
  email: string;
  role: AdminRole;
  actorEmail: string | null;
}): Promise<AdminUserPublic> {
  if (!(await ensureAdminUsersTable())) {
    throw Object.assign(new Error("admin_users table missing. Run db:run-admin-users-sql"), {
      status: 503
    });
  }
  const email = input.email.trim().toLowerCase();
  const existing = await AdminUser.findOne({ where: { email } });
  if (existing) {
    await existing.update({
      role: input.role,
      updatedBy: input.actorEmail,
      updatedAt: new Date()
    } as any);
    await existing.reload();
    setCache(email, existing.role as AdminRole, existing.isActive);
    return toPublic(existing);
  }

  const shared = process.env.ADMIN_PASSWORD || "";
  if (!shared) {
    throw Object.assign(
      new Error(
        "No admin_users row for this email. Create an admin account first, or set ADMIN_PASSWORD to auto-provision whitelist emails."
      ),
      { status: 400 }
    );
  }

  const name = email.split("@")[0] || email;
  const now = new Date();
  const row = await AdminUser.create({
    name,
    email,
    passwordHash: await hashPassword(shared),
    role: input.role,
    isActive: true,
    lastLoginAt: null,
    failedLoginCount: 0,
    createdBy: input.actorEmail ?? "role_assignment",
    updatedBy: input.actorEmail,
    createdAt: now,
    updatedAt: now
  } as any);
  setCache(email, input.role, true);
  return toPublic(row);
}

export async function countActiveSuperAdmins(excludeEmail?: string): Promise<number> {
  if (!(await ensureAdminUsersTable())) return 0;
  const { Op } = await import("sequelize");
  const where: Record<string, unknown> = { role: "SUPER_ADMIN", isActive: true };
  if (excludeEmail) {
    where.email = { [Op.ne]: excludeEmail.trim().toLowerCase() };
  }
  return AdminUser.count({ where: where as any });
}

export async function getLatestRoleMeta(): Promise<{
  updatedAt: string | null;
  updatedBy: string | null;
}> {
  if (!(await ensureAdminUsersTable())) return { updatedAt: null, updatedBy: null };
  const row = await AdminUser.findOne({
    order: [["updatedAt", "DESC"]],
    attributes: ["updatedAt", "updatedBy"]
  });
  if (!row) return { updatedAt: null, updatedBy: null };
  return {
    updatedAt: row.updatedAt?.toISOString() ?? null,
    updatedBy: row.updatedBy
  };
}

/**
 * One-time import: admin-roles.json → admin_users.role, then rename the file.
 */
export async function migrateJsonAssignmentsToDatabase(): Promise<number> {
  if (!(await ensureAdminUsersTable())) return 0;
  const fs = await import("fs");
  const path = await import("path");
  const rolesPath = path.join(__dirname, "../../data/admin-roles.json");
  if (!fs.existsSync(rolesPath)) return 0;

  let assignments: Record<string, string> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(rolesPath, "utf8")) as {
      assignments?: Record<string, string>;
    };
    assignments = parsed.assignments || {};
  } catch {
    return 0;
  }

  let migrated = 0;
  for (const [rawEmail, rawRole] of Object.entries(assignments)) {
    const email = rawEmail.trim().toLowerCase();
    if (!email || !isAdminRole(String(rawRole))) continue;
    try {
      await ensureDbAdminForAssignment({
        email,
        role: rawRole as AdminRole,
        actorEmail: "json_migration"
      });
      migrated += 1;
    } catch (e) {
      console.warn(
        `[admin-users] skip JSON migrate for ${email}:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  // Also ensure whitelist emails exist with default roles if missing
  const whitelist = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  for (let i = 0; i < whitelist.length; i++) {
    const email = whitelist[i];
    if (accountCache.has(email)) continue;
    const role: AdminRole =
      (isAdminRole(String(assignments[email])) ? (assignments[email] as AdminRole) : null) ??
      (i === 0 ? "SUPER_ADMIN" : "ADMIN");
    try {
      await ensureDbAdminForAssignment({
        email,
        role,
        actorEmail: "whitelist_migration"
      });
      migrated += 1;
    } catch {
      /* shared password missing — leave as whitelist-only until login provisions */
    }
  }

  try {
    const dest = `${rolesPath}.migrated`;
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    fs.renameSync(rolesPath, dest);
    console.log(`[admin-users] migrated ${migrated} role assignment(s); archived admin-roles.json`);
  } catch (e) {
    console.warn(
      "[admin-users] roles migrated but could not archive JSON:",
      e instanceof Error ? e.message : e
    );
  }

  await warmRoleCache();
  return migrated;
}

export async function bootstrapAdminUsers(): Promise<void> {
  const ok = await ensureAdminUsersTable();
  if (!ok) {
    console.warn("[admin-users] table missing — run npm run db:run-admin-users-sql");
    return;
  }
  try {
    await migrateJsonAssignmentsToDatabase();
  } catch (e) {
    console.warn("[admin-users] JSON migration failed:", e instanceof Error ? e.message : e);
  }
  console.log("[admin-users] ready (DB is role assignment source)");
}
