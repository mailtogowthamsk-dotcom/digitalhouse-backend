import { Op, type WhereOptions } from "sequelize";
import { sequelize } from "../config/db";
import { User, UserProfile, PendingProfileUpdate, AdminVerification, MatrimonySubscription, Post, PostReport } from "../models";
import { ensureUserProfile } from "./ensureUserProfile";
import { resolveLoginSource } from "../utils/authProvider.util";
import type { MatrimonySection, BusinessSection } from "../models/UserProfile.model";
import { signAdminToken } from "../utils/jwt.util";
import { normalizeJsonColumn, SECTION_ALLOWED_KEYS } from "./Profile.service";
import { toSignedUrlIfR2 } from "../utils/r2Client";
import { getPendingReportCount } from "./AdminReports.service";
import { resolveAdminRole } from "./AdminRoles.service";
import { ADMIN_ROLE_LABELS } from "../constants/adminRoles.constants";
import { registrationStatusService } from "./RegistrationStatus.service";
import { dummyPasswordVerify, safeEqualString } from "../utils/adminPassword.util";

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

/** Whitelist: comma-separated ADMIN_EMAILS; single ADMIN_PASSWORD for all admins */
function getAdminWhitelist(): { emails: Set<string>; password: string } {
  const emailsRaw = process.env.ADMIN_EMAILS || "";
  const emails = new Set(emailsRaw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
  const password = process.env.ADMIN_PASSWORD || "";
  return { emails, password };
}

/**
 * Admin login: prefer admin_users (hashed password); fall back to ADMIN_EMAILS + shared ADMIN_PASSWORD.
 * Successful legacy logins are auto-provisioned into admin_users when the table exists.
 */
export async function adminLogin(
  email: string,
  password: string
): Promise<{ token: string; admin: { email: string; role: string; roleLabel: string; name?: string } }> {
  const normalized = email.trim().toLowerCase();
  const AdminUsers = await import("./AdminUsers.service");
  const dbResult = await AdminUsers.tryDatabaseLogin(normalized, password);

  if (dbResult.ok) {
    const token = signAdminToken({ email: dbResult.email, role: dbResult.role });
    return {
      token,
      admin: {
        email: dbResult.email,
        role: dbResult.role,
        roleLabel: ADMIN_ROLE_LABELS[dbResult.role],
        name: dbResult.name
      }
    };
  }

  // Known DB account — never fall through to shared password
  if (
    dbResult.reason === "bad_password" ||
    dbResult.reason === "inactive" ||
    dbResult.reason === "locked"
  ) {
    const err = new Error("Invalid credentials");
    (err as any).status = dbResult.reason === "locked" ? 429 : 401;
    if (dbResult.reason === "locked") {
      err.message = "Too many failed attempts. Try again later.";
    }
    throw err;
  }

  // Equalize timing vs hashed-password path when email is unknown to DB
  await dummyPasswordVerify(password);

  const { emails, password: expectedPassword } = getAdminWhitelist();
  if (!emails.has(normalized)) {
    const err = new Error("Invalid credentials");
    (err as any).status = 401;
    throw err;
  }
  if (!expectedPassword || !safeEqualString(password, expectedPassword)) {
    const err = new Error("Invalid credentials");
    (err as any).status = 401;
    throw err;
  }

  const role = resolveAdminRole(normalized);
  void AdminUsers.provisionFromLegacyLogin({ email: normalized, password, role }).catch((e) =>
    console.warn("[admin-users] legacy provision failed:", e instanceof Error ? e.message : e)
  );

  const token = signAdminToken({ email: normalized, role });
  return {
    token,
    admin: { email: normalized, role, roleLabel: ADMIN_ROLE_LABELS[role] }
  };
}

/** List users awaiting registration review (PENDING / PENDING_REVIEW / CHANGES_REQUESTED) */
export async function listPendingUsers(opts?: {
  limit?: number;
  offset?: number;
}): Promise<{ users: User[]; total: number }> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const offset = Math.max(opts?.offset ?? 0, 0);
  const where = {
    status: { [Op.in]: ["PENDING", "PENDING_REVIEW", "CHANGES_REQUESTED"] }
  };
  const [users, total] = await Promise.all([
    User.findAll({
      where,
      order: [["createdAt", "ASC"]],
      limit,
      offset
    }),
    User.count({ where })
  ]);
  return { users, total };
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
  const where: WhereOptions = {};
  if (status) {
    Object.assign(where, { status: status as any });
  } else {
    // Hide soft-deleted users from default list
    Object.assign(where, { status: { [Op.ne]: "DELETED" } });
  }
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

  // Lightweight subscription badges for current page only
  const ids = rows.map((u) => u.id);
  const subs =
    ids.length === 0
      ? []
      : await MatrimonySubscription.findAll({
          where: { userId: { [Op.in]: ids }, status: "ACTIVE" },
          attributes: ["userId", "plan", "status", "endsAt"]
        });
  const subByUser = new Map(subs.map((s) => [s.userId, s]));

  return {
    users: await Promise.all(
      rows.map(async (u) => {
        const sub = subByUser.get(u.id);
        const photo = u.profilePhoto
          ? (await toSignedUrlIfR2(u.profilePhoto)) ?? u.profilePhoto
          : null;
        return {
          id: u.id,
          fullName: u.fullName,
          username: u.username ?? null,
          email: u.email,
          mobile: u.mobile ?? null,
          community: u.community ?? null,
          kulam: u.kulam ?? null,
          gender: u.gender ?? null,
          district: u.district ?? null,
          city: u.city ?? null,
          status: u.status,
          emailVerified: !!u.emailVerified,
          loginSource: resolveLoginSource(u),
          profilePhoto: photo,
          subscriptionPlan: sub?.plan ?? null,
          subscriptionStatus: sub?.status ?? null,
          communityRole: u.communityRole ?? null,
          lastLoginProvider: u.lastLoginProvider ?? null,
          createdAt: u.createdAt.toISOString(),
          updatedAt: u.updatedAt.toISOString(),
          deletedAt: u.deletedAt ? u.deletedAt.toISOString() : null
        };
      })
    ),
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
  return registrationStatusService.approveRegistration(userId, verifiedBy, remarks);
}

/**
 * Reject user: set status REJECTED and create audit record with reason.
 */
export async function rejectUser(
  userId: number,
  verifiedBy: string,
  remarks: string
): Promise<User> {
  return registrationStatusService.rejectRegistration(userId, verifiedBy, remarks);
}

/** Ask the registrant to correct mobile and/or profile photo. */
export async function requestRegistrationChanges(
  userId: number,
  verifiedBy: string,
  remarks: string,
  requestedFields: Array<"mobile" | "profilePhoto">
): Promise<User> {
  return registrationStatusService.requestRegistrationChanges(
    userId,
    verifiedBy,
    remarks,
    requestedFields
  );
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
  pendingMarketplaceListings: number;
  reportedMarketplaceListings: number;
}> {
  const [
    totalUsers,
    pendingUserApprovals,
    pendingMatrimony,
    pendingBusiness,
    reportedPosts,
    pendingMarketplaceListings,
    pendingMarketplaceReports
  ] = await Promise.all([
    User.count(),
    User.count({
      where: { status: { [Op.in]: ["PENDING", "PENDING_REVIEW", "CHANGES_REQUESTED"] } }
    }),
    PendingProfileUpdate.count({ where: { section: "MATRIMONY", status: "PENDING" } }),
    PendingProfileUpdate.count({ where: { section: "BUSINESS", status: "PENDING" } }),
    getPendingReportCount(),
    Post.count({ where: { postType: "MARKETPLACE", marketplaceStatus: "PENDING_REVIEW" } }),
    (async () => {
      const rows = await PostReport.findAll({
        where: { status: "PENDING" },
        attributes: ["postId"],
        group: ["postId"],
        raw: true
      });
      const ids = (rows as { postId: number }[]).map((r) => r.postId);
      if (!ids.length) return 0;
      return Post.count({ where: { id: { [Op.in]: ids }, postType: "MARKETPLACE" } });
    })()
  ]);
  return {
    totalUsers,
    pendingUserApprovals,
    pendingMatrimonyApprovals: pendingMatrimony,
    pendingBusinessApprovals: pendingBusiness,
    reportedPosts,
    pendingMarketplaceListings,
    reportedMarketplaceListings: pendingMarketplaceReports
  };
}
