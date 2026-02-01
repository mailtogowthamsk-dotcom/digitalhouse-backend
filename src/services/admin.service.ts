import { User, UserProfile, PendingProfileUpdate, AdminVerification, PostReport } from "../models";
import { sendApprovalEmail, sendRejectionEmail } from "./mail.service";
import type { MatrimonySection, BusinessSection } from "../models/UserProfile.model";
import { signAdminToken } from "../utils/jwt.util";

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
): Promise<{ token: string; admin: { email: string } }> {
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
  const token = signAdminToken({ email: normalized });
  return { token, admin: { email: normalized } };
}

/** List users with status PENDING (awaiting admin verification) */
export async function listPendingUsers(): Promise<User[]> {
  return User.findAll({
    where: { status: PENDING },
    order: [["createdAt", "ASC"]]
  });
}

/** List all users (paginated) for User Management */
export async function listUsers(page: number = 1, limit: number = 20, status?: string) {
  const offset = (page - 1) * limit;
  const where = status ? { status: status as any } : {};
  const { count, rows } = await User.findAndCountAll({
    where,
    order: [["createdAt", "DESC"]],
    limit: Math.min(limit, 100),
    offset
  });
  return {
    users: rows.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      mobile: u.mobile ?? null,
      status: u.status,
      createdAt: u.createdAt.toISOString()
    })),
    total: count,
    page,
    limit
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
};

/** List pending profile updates (Matrimony & Business) for admin review */
export async function listPendingProfileUpdates(): Promise<PendingProfileUpdateDto[]> {
  const list = await PendingProfileUpdate.findAll({
    where: { status: "PENDING" },
    order: [["submittedAt", "ASC"]],
    include: [{ model: User, as: "User", attributes: ["id", "fullName", "email"] }]
  });
  const userIds = [...new Set(list.map((r) => r.userId))];
  const profiles = await UserProfile.findAll({ where: { userId: userIds } });
  const profileByUser = new Map(profiles.map((p) => [p.userId, p]));

  return list.map((row) => {
    const user = (row as any).User as User;
    const profile = profileByUser.get(row.userId);
    const currentApproved =
      row.section === "MATRIMONY"
        ? (profile?.matrimony as MatrimonySection) ?? null
        : (profile?.business as BusinessSection) ?? null;
    return {
      id: row.id,
      userId: row.userId,
      userEmail: user?.email ?? "",
      userName: user?.fullName ?? "",
      section: row.section,
      data: (row.data as Record<string, unknown>) ?? {},
      status: row.status,
      submittedAt: row.submittedAt.toISOString(),
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
      adminRemarks: row.adminRemarks,
      currentApproved: currentApproved as Record<string, unknown> | null
    };
  });
}

/** Approve pending profile update: copy data to user_profiles, mark update as APPROVED */
export async function approveProfileUpdate(
  updateId: number,
  adminId: string,
  remarks?: string | null
): Promise<void> {
  const row = await PendingProfileUpdate.findByPk(updateId);
  if (!row) throw new Error("Pending update not found");
  if (row.status !== "PENDING") throw new Error("Update is not pending");

  let profile = await UserProfile.findOne({ where: { userId: row.userId } });
  if (!profile) profile = await UserProfile.create({ userId: row.userId } as any);

  const data = (row.data as Record<string, unknown>) ?? {};
  const sectionKey = row.section === "MATRIMONY" ? "matrimony" : "business";
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
    PostReport.count()
  ]);
  return {
    totalUsers,
    pendingUserApprovals,
    pendingMatrimonyApprovals: pendingMatrimony,
    pendingBusinessApprovals: pendingBusiness,
    reportedPosts
  };
}
