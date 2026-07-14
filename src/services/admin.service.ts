import { Op, type WhereOptions } from "sequelize";
import { sequelize } from "../config/db";
import { User, UserProfile, PendingProfileUpdate, AdminVerification } from "../models";
import { ensureUserProfile } from "./ensureUserProfile";
import { resolveLoginSource } from "../utils/authProvider.util";
import { sendApprovalEmail, sendRejectionEmail } from "./mail.service";
import type { MatrimonySection, BusinessSection } from "../models/UserProfile.model";
import { signAdminToken } from "../utils/jwt.util";
import { normalizeJsonColumn, SECTION_ALLOWED_KEYS } from "./Profile.service";
import { toSignedUrlIfR2 } from "../utils/r2Client";
import { getPendingReportCount } from "./AdminReports.service";
import { resolveAdminRole } from "./AdminRoles.service";
import { ADMIN_ROLE_LABELS } from "../constants/adminRoles.constants";

const MATRIMONY_MEDIA_URL_KEYS = ["candidatePhotoUrl", "profilePhotoUrl", "horoscopeDocumentUrl"] as const;

/** R2 bucket is private; admin UI needs time-limited signed GET URLs to view uploads. */
async function signMatrimonyMediaUrls(
  data: Record<string, unknown> | null
): Promise<Record<string, unknown> | null> {
  if (!data) return null;
  const out = { ...data };
  await Promise.all(
    MATRIMONY_MEDIA_URL_KEYS.map(async (key) => {
      const v = out[key];
      if (typeof v === "string" && v.trim()) {
        out[key] = (await toSignedUrlIfR2(v)) ?? v;
      }
    })
  );
  return out;
}

const PENDING = "PENDING";

/** Whitelist: comma-separated ADMIN_EMAILS; single ADMIN_PASSWORD for all admins */
function getAdminWhitelist(): { emails: Set<string>; password: string } {
  const emailsRaw = process.env.ADMIN_EMAILS || "";
  const emails = new Set(emailsRaw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
  const password = process.env.ADMIN_PASSWORD || "";
  return { emails, password };
}

/** Admin login: email must be in whitelist, password must match. Returns JWT. */
export async function adminLogin(
  email: string,
  password: string
): Promise<{ token: string; admin: { email: string; role: string; roleLabel: string } }> {
  const { emails, password: expectedPassword } = getAdminWhitelist();
  const normalized = email.trim().toLowerCase();
  if (!emails.has(normalized)) {
    const err = new Error("Invalid credentials");
    (err as any).status = 401;
    throw err;
  }
  if (expectedPassword === "" || password !== expectedPassword) {
    const err = new Error("Invalid credentials");
    (err as any).status = 401;
    throw err;
  }
  const role = resolveAdminRole(normalized);
  const token = signAdminToken({ email: normalized, role });
  return {
    token,
    admin: { email: normalized, role, roleLabel: ADMIN_ROLE_LABELS[role] }
  };
}

/** List users with status PENDING (awaiting admin verification) */
export async function listPendingUsers(): Promise<User[]> {
  return User.findAll({
    where: { status: PENDING },
    order: [["createdAt", "ASC"]]
  });
}

const USER_SORT_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "fullName",
  "email",
  "status",
  "id"
]);

/** List all users (paginated) for User Management */
export async function listUsers(
  page: number = 1,
  limit: number = 20,
  status?: string,
  q?: string,
  loginSource?: string,
  filters?: {
    community?: string;
    gender?: string;
    sortBy?: string;
    sortDir?: "asc" | "desc";
  }
) {
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safePage = Math.max(1, page);
  const offset = (safePage - 1) * safeLimit;
  const where: WhereOptions = status ? { status: status as any } : {};
  const term = q?.trim();
  if (term && term.length >= 1) {
    Object.assign(where, {
      [Op.or]: [
        { fullName: { [Op.like]: `%${term}%` } },
        { username: { [Op.like]: `%${term}%` } },
        { email: { [Op.like]: `%${term}%` } },
        { mobile: { [Op.like]: `%${term}%` } }
      ]
    });
  }
  if (filters?.community?.trim()) {
    Object.assign(where, { community: { [Op.like]: `%${filters.community.trim()}%` } });
  }
  if (filters?.gender?.trim()) {
    Object.assign(where, { gender: filters.gender.trim() });
  }
  if (loginSource === "google") {
    Object.assign(where, {
      googleId: { [Op.ne]: null },
      [Op.and]: [
        sequelize.literal(
          `JSON_CONTAINS(COALESCE(linked_providers, JSON_ARRAY('EXISTING_LOGIN')), '"GOOGLE"')`
        ),
        sequelize.literal(
          `NOT JSON_CONTAINS(COALESCE(linked_providers, JSON_ARRAY('EXISTING_LOGIN')), '"EXISTING_LOGIN"')`
        )
      ]
    });
  } else if (loginSource === "existing") {
    Object.assign(where, { googleId: { [Op.is]: null } });
  } else if (loginSource === "both") {
    Object.assign(where, {
      googleId: { [Op.ne]: null },
      [Op.and]: sequelize.literal(
        `JSON_CONTAINS(COALESCE(linked_providers, JSON_ARRAY()), '"GOOGLE"') AND JSON_CONTAINS(COALESCE(linked_providers, JSON_ARRAY()), '"EXISTING_LOGIN"')`
      )
    });
  }
  const sortBy = filters?.sortBy && USER_SORT_FIELDS.has(filters.sortBy) ? filters.sortBy : "createdAt";
  const sortDir = filters?.sortDir === "asc" ? "ASC" : "DESC";
  const { count, rows } = await User.findAndCountAll({
    where,
    order: [[sortBy, sortDir]],
    limit: safeLimit,
    offset
  });
  return {
    users: rows.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      username: u.username ?? null,
      email: u.email,
      mobile: u.mobile ?? null,
      community: u.community ?? null,
      gender: u.gender ?? null,
      status: u.status,
      loginSource: resolveLoginSource(u),
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString()
    })),
    total: count,
    page: safePage,
    limit: safeLimit
  };
}

/** Get full user profile by id (for admin view) */
export async function getUserById(id: number): Promise<User | null> {
  return User.findByPk(id);
}

/**
 * Approve user: set status APPROVED and create audit record.
 * verifiedBy: admin identifier (e.g. from API key or session).
 */
export async function approveUser(
  userId: number,
  verifiedBy: string,
  remarks?: string | null
): Promise<User> {
  const user = await User.findByPk(userId);
  if (!user) throw new Error("User not found.");
  if (user.status !== PENDING) throw new Error("User is not pending approval.");

  await user.update({ status: "APPROVED" });
  await AdminVerification.create({
    userId: user.id,
    verifiedBy,
    verifiedAt: new Date(),
    remarks: remarks || null,
    createdAt: new Date()
  } as any);

  try {
    await sendApprovalEmail(user.email, user.fullName, remarks ?? undefined);
  } catch (e) {
    console.error("Failed to send approval email to", user.email, e);
  }

  return user;
}

/**
 * Reject user: set status REJECTED and create audit record with reason.
 */
export async function rejectUser(
  userId: number,
  verifiedBy: string,
  remarks: string
): Promise<User> {
  const user = await User.findByPk(userId);
  if (!user) throw new Error("User not found.");
  if (user.status !== PENDING) throw new Error("User is not pending approval.");

  await user.update({ status: "REJECTED" });
  await AdminVerification.create({
    userId: user.id,
    verifiedBy,
    verifiedAt: new Date(),
    remarks: remarks.trim() || "Rejected by admin",
    createdAt: new Date()
  } as any);

  try {
    await sendRejectionEmail(user.email, user.fullName, remarks.trim() || undefined);
  } catch (e) {
    console.error("Failed to send rejection email to", user.email, e);
  }

  return user;
}

/** Audit log: list verifications for a user */
export async function getVerificationHistory(userId: number) {
  return AdminVerification.findAll({
    where: { userId },
    order: [["verifiedAt", "DESC"]]
  });
}

// ---------------------------------------------------------------------------
// Pending profile updates (Matrimony / Business)
// ---------------------------------------------------------------------------

export type PendingProfileUpdateDto = {
  id: number;
  userId: number;
  userEmail: string;
  userName: string;
  section: "MATRIMONY" | "BUSINESS";
  data: Record<string, unknown>;
  status: string;
  submittedAt: string;
  reviewedAt: string | null;
  adminRemarks: string | null;
  /** Current approved data in user_profiles (for compare) */
  currentApproved: Record<string, unknown> | null;
  /** False when user saved draft only (not pressed Submit in app) */
  submittedForReview?: boolean;
};

/** List pending profile updates (Matrimony & Business) for admin review.
 * Supports optional section/page/limit/q for scalable browsing.
 * When page/limit omitted, returns full list (backward compatible).
 */
export async function listPendingProfileUpdates(opts?: {
  section?: "MATRIMONY" | "BUSINESS";
  page?: number;
  limit?: number;
  q?: string;
}): Promise<{
  updates: PendingProfileUpdateDto[];
  total: number;
  page: number;
  limit: number;
}> {
  const where: Record<string, unknown> = { status: "PENDING" };
  if (opts?.section) where.section = opts.section;

  const page = Math.max(1, opts?.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 20));
  const paginate = opts?.page != null || opts?.limit != null || opts?.section != null || opts?.q != null;

  const userWhere: WhereOptions | undefined = (() => {
    const term = opts?.q?.trim();
    if (!term) return undefined;
    return {
      [Op.or]: [
        { fullName: { [Op.like]: `%${term}%` } },
        { email: { [Op.like]: `%${term}%` } },
        { mobile: { [Op.like]: `%${term}%` } }
      ]
    };
  })();

  const { count, rows: list } = await PendingProfileUpdate.findAndCountAll({
    where,
    order: [["submittedAt", "ASC"]],
    include: [
      {
        model: User,
        as: "User",
        attributes: ["id", "fullName", "email"],
        required: Boolean(userWhere),
        ...(userWhere ? { where: userWhere } : {})
      }
    ],
    ...(paginate
      ? {
          limit,
          offset: (page - 1) * limit,
          distinct: true
        }
      : {})
  });

  const userIds = [...new Set(list.map((r) => r.userId))];
  const profiles = await UserProfile.findAll({ where: { userId: userIds } });
  const profileByUser = new Map(profiles.map((p) => [p.userId, p]));

  const allowedKeysBySection = {
    MATRIMONY: SECTION_ALLOWED_KEYS.matrimony,
    BUSINESS: SECTION_ALLOWED_KEYS.business
  };

  const updates = await Promise.all(
    list.map(async (row) => {
      const user = (row as any).User as User;
      const profile = profileByUser.get(row.userId);
      const allowedKeys = allowedKeysBySection[row.section];
      const currentApprovedRaw =
        row.section === "MATRIMONY" ? profile?.matrimony : profile?.business;
      let currentApproved = normalizeJsonColumn(currentApprovedRaw, allowedKeys) as Record<
        string,
        unknown
      > | null;
      const data = normalizeJsonColumn(row.data, allowedKeys) ?? {};
      const { _submittedForReview: submittedFlag, ...dataForAdmin } = data;
      const submittedForReview =
        row.section === "MATRIMONY" ? submittedFlag !== false : true;

      let pendingData = dataForAdmin;
      if (row.section === "MATRIMONY") {
        pendingData = (await signMatrimonyMediaUrls(dataForAdmin)) ?? dataForAdmin;
        currentApproved = await signMatrimonyMediaUrls(currentApproved);
      }

      return {
        id: row.id,
        userId: row.userId,
        userEmail: user?.email ?? "",
        userName: user?.fullName ?? "",
        section: row.section,
        data: pendingData,
        status: row.status,
        submittedAt: row.submittedAt.toISOString(),
        reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
        adminRemarks: row.adminRemarks,
        currentApproved,
        submittedForReview
      };
    })
  );

  return {
    updates,
    total: paginate ? count : updates.length,
    page: paginate ? page : 1,
    limit: paginate ? limit : updates.length || limit
  };
}

/** Approve pending profile update: copy data to user_profiles (clean JSON only), mark update as APPROVED */
export async function approveProfileUpdate(
  updateId: number,
  adminId: string,
  remarks?: string | null
): Promise<void> {
  const row = await PendingProfileUpdate.findByPk(updateId);
  if (!row) throw new Error("Pending update not found");
  if (row.status !== "PENDING") throw new Error("Update is not pending");

  let profile = await ensureUserProfile(row.userId);

  const sectionKey = row.section === "MATRIMONY" ? "matrimony" : "business";
  const allowedKeys = SECTION_ALLOWED_KEYS[sectionKey];
  const raw = normalizeJsonColumn(row.data, allowedKeys) ?? {};
  const { _submittedForReview: _skip, ...data } = raw;
  await profile.update({ [sectionKey]: data } as any);
  await row.update({
    status: "APPROVED",
    reviewedAt: new Date(),
    adminRemarks: remarks ?? null,
    updatedAt: new Date()
  } as any);
}

/** Reject pending profile update: discard data, mark as REJECTED, store remarks */
export async function rejectProfileUpdate(
  updateId: number,
  adminId: string,
  remarks: string
): Promise<void> {
  const row = await PendingProfileUpdate.findByPk(updateId);
  if (!row) throw new Error("Pending update not found");
  if (row.status !== "PENDING") throw new Error("Update is not pending");

  await row.update({
    status: "REJECTED",
    reviewedAt: new Date(),
    adminRemarks: remarks.trim() || "Rejected by admin",
    updatedAt: new Date()
  } as any);
}

/** Dashboard stats for admin UI */
export async function getDashboardStats(): Promise<{
  totalUsers: number;
  pendingUserApprovals: number;
  pendingMatrimonyApprovals: number;
  pendingBusinessApprovals: number;
  reportedPosts: number;
}> {
  const [totalUsers, pendingUserApprovals, pendingMatrimony, pendingBusiness, reportedPosts] = await Promise.all([
    User.count(),
    User.count({ where: { status: "PENDING" } }),
    PendingProfileUpdate.count({ where: { section: "MATRIMONY", status: "PENDING" } }),
    PendingProfileUpdate.count({ where: { section: "BUSINESS", status: "PENDING" } }),
    getPendingReportCount()
  ]);
  return {
    totalUsers,
    pendingUserApprovals,
    pendingMatrimonyApprovals: pendingMatrimony,
    pendingBusinessApprovals: pendingBusiness,
    reportedPosts
  };
}
