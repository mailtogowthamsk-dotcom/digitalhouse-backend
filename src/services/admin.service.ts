import { User, AdminVerification } from "../models";
import { sendApprovalEmail, sendRejectionEmail } from "./mail.service";

const PENDING = "PENDING";

/** List users with status PENDING (awaiting admin verification) */
export async function listPendingUsers(): Promise<User[]> {
  return User.findAll({
    where: { status: PENDING },
    order: [["createdAt", "ASC"]]
  });
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
