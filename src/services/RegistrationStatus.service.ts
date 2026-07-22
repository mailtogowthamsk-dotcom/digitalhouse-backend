/**
 * Account registration approval workflow.
 * Separates identity (JWT) from app access (registration status).
 */

import { Op } from "sequelize";
import { User, AdminVerification } from "../models";
import {
  REGISTRATION_CORRECTION_FIELDS,
  canIssueSessionForStatus,
  isReviewableRegistrationStatus,
  resolveRegistrationGate,
  type RegistrationCorrectionField,
  type RegistrationGate
} from "../constants/registrationStatus.constants";
import { sendApprovalEmail, sendRejectionEmail, sendRegistrationChangesEmail } from "./mail.service";
import {
  notifyAccountApproved,
  notifyAccountRejected,
  notifyAccountChangesRequested
} from "./Notification.service";
import { toSignedUrlIfR2 } from "../utils/r2Client";

function httpError(message: string, status: number, code?: string): Error {
  const err = new Error(message);
  (err as any).status = status;
  if (code) (err as any).code = code;
  return err;
}

function parseRequestedFields(raw: unknown): RegistrationCorrectionField[] {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(REGISTRATION_CORRECTION_FIELDS);
  return value.filter((f): f is RegistrationCorrectionField => typeof f === "string" && allowed.has(f));
}

/** Last 10 digits — treats +91 / spaces / dashes as the same number. */
function mobileDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

async function findMobileConflict(
  userId: number,
  normalized: string
): Promise<boolean> {
  const candidates = await User.findAll({
    attributes: ["id", "mobile", "pendingMobile"],
    where: {
      id: { [Op.ne]: userId },
      [Op.or]: [
        { mobile: { [Op.not]: null } },
        { pendingMobile: { [Op.not]: null } }
      ]
    }
  });
  return candidates.some((u) => {
    const live = u.mobile ? mobileDigits(u.mobile) : "";
    const pending = u.pendingMobile ? mobileDigits(u.pendingMobile) : "";
    return live === normalized || pending === normalized;
  });
}

/** Block suspended accounts from receiving a session after identity success. */
export function assertCanIssueSession(user: User): void {
  if (user.status === "SUSPENDED") {
    throw httpError("Your account has been suspended. Please contact support.", 403, "ACCOUNT_SUSPENDED");
  }
  if (!canIssueSessionForStatus(user.status)) {
    throw httpError("Your account cannot sign in at this time.", 403, "ACCOUNT_BLOCKED");
  }
}

export function getRegistrationGate(user: User): RegistrationGate {
  return resolveRegistrationGate({
    status: user.status,
    profileComplete: user.profileComplete
  });
}

export async function requestRegistrationChanges(
  userId: number,
  verifiedBy: string,
  remarks: string,
  requestedFields: RegistrationCorrectionField[]
): Promise<User> {
  const user = await User.findByPk(userId);
  if (!user) throw httpError("User not found.", 404);
  if (!isReviewableRegistrationStatus(user.status)) {
    throw httpError("User is not awaiting registration review.", 400);
  }
  const fields = [...new Set(requestedFields)].filter((f) =>
    (REGISTRATION_CORRECTION_FIELDS as readonly string[]).includes(f)
  );
  if (fields.length === 0) {
    throw httpError("Select at least one field to correct (mobile or profile photo).", 400);
  }
  const note = remarks.trim();
  if (!note) throw httpError("Please provide remarks for the user.", 400);

  await user.update({
    status: "CHANGES_REQUESTED",
    registrationAdminRemarks: note,
    registrationRequestedFields: fields,
    registrationReviewedAt: new Date(),
    // Clear previous pending replacements when requesting a new round.
    pendingMobile: null,
    pendingProfilePhoto: null
  } as any);

  await AdminVerification.create({
    userId: user.id,
    verifiedBy,
    verifiedAt: new Date(),
    remarks: `CHANGES_REQUESTED: ${note}`,
    createdAt: new Date()
  } as any);

  try {
    await sendRegistrationChangesEmail(user.email, user.fullName, note);
  } catch (e) {
    console.error("Failed to send registration changes email to", user.email, e);
  }
  void notifyAccountChangesRequested(user.id, note).catch(() => undefined);

  return user;
}

export async function submitRegistrationCorrection(
  userId: number,
  input: { mobile?: string | null; profilePhoto?: string | null }
): Promise<User> {
  const user = await User.findByPk(userId);
  if (!user) throw httpError("User not found.", 404);
  if (user.status !== "CHANGES_REQUESTED") {
    throw httpError("Registration corrections are only allowed when changes were requested.", 403);
  }

  const fields = parseRequestedFields(user.registrationRequestedFields);
  if (fields.length === 0) {
    throw httpError("No correction fields were requested by admin.", 400);
  }
  const updates: Record<string, unknown> = {};

  if (fields.includes("mobile")) {
    if (input.mobile === undefined) {
      throw httpError("Please update your mobile number.", 400);
    }
    const rawMobile = input.mobile?.trim() || null;
    if (!rawMobile) throw httpError("Mobile number is required.", 400);
    const normalized = mobileDigits(rawMobile);
    if (normalized.length < 10) {
      throw httpError("Enter a valid 10-digit mobile number.", 400);
    }
    const currentDigits = user.mobile ? mobileDigits(user.mobile) : "";
    // Same number as today is allowed (admin may only need a photo fix too).
    if (normalized !== currentDigits) {
      const taken = await findMobileConflict(userId, normalized);
      if (taken) {
        throw httpError(
          "This mobile number is already used by another account. Please use a different number.",
          409
        );
      }
    }
    updates.pendingMobile = normalized;
  }

  if (fields.includes("profilePhoto")) {
    if (input.profilePhoto === undefined) {
      throw httpError("Please upload a replacement profile photo.", 400);
    }
    const photo = input.profilePhoto?.trim() || null;
    if (!photo) throw httpError("Profile photo is required.", 400);
    updates.pendingProfilePhoto = photo;
  }

  updates.status = "PENDING";
  updates.registrationResubmittedAt = new Date();

  await user.update(updates as any);

  const pendingPhoto = (updates.pendingProfilePhoto as string | undefined) || user.pendingProfilePhoto;
  if (pendingPhoto) {
    try {
      const { mediaService } = await import("./Media.service");
      await mediaService.markMediaUrlsAttached(userId, [pendingPhoto]);
    } catch {
      /* best-effort */
    }
  }

  return user.reload();
}

/**
 * Approve registration. Applies pending mobile/photo replacements when present.
 */
export async function approveRegistration(
  userId: number,
  verifiedBy: string,
  remarks?: string | null
): Promise<User> {
  const user = await User.findByPk(userId);
  if (!user) throw httpError("User not found.", 404);
  if (!isReviewableRegistrationStatus(user.status)) {
    throw httpError("User is not pending approval.", 400);
  }

  const nextMobile = user.pendingMobile?.trim() || user.mobile;
  const nextPhoto = user.pendingProfilePhoto?.trim() || user.profilePhoto;

  await user.update({
    status: "APPROVED",
    mobile: nextMobile,
    profilePhoto: nextPhoto,
    pendingMobile: null,
    pendingProfilePhoto: null,
    registrationAdminRemarks: null,
    registrationRequestedFields: null,
    registrationReviewedAt: new Date()
  } as any);

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
  void notifyAccountApproved(user.id).catch(() => undefined);

  return user;
}

export async function rejectRegistration(
  userId: number,
  verifiedBy: string,
  remarks: string
): Promise<User> {
  const user = await User.findByPk(userId);
  if (!user) throw httpError("User not found.", 404);
  if (!isReviewableRegistrationStatus(user.status)) {
    throw httpError("User is not pending approval.", 400);
  }
  const note = remarks.trim() || "Rejected by admin";

  await user.update({
    status: "REJECTED",
    registrationAdminRemarks: note,
    registrationRequestedFields: null,
    pendingMobile: null,
    pendingProfilePhoto: null,
    registrationReviewedAt: new Date()
  } as any);

  await AdminVerification.create({
    userId: user.id,
    verifiedBy,
    verifiedAt: new Date(),
    remarks: note,
    createdAt: new Date()
  } as any);

  try {
    await sendRejectionEmail(user.email, user.fullName, note);
  } catch (e) {
    console.error("Failed to send rejection email to", user.email, e);
  }
  void notifyAccountRejected(user.id, note).catch(() => undefined);

  return user;
}

/** Admin detail payload with signed photo URLs for side-by-side review. */
export async function toAdminRegistrationReview(user: User) {
  const [currentPhoto, pendingPhoto] = await Promise.all([
    toSignedUrlIfR2(user.profilePhoto ?? null),
    toSignedUrlIfR2(user.pendingProfilePhoto ?? null)
  ]);
  return {
    status: user.status,
    gate: getRegistrationGate(user),
    registrationAdminRemarks: user.registrationAdminRemarks ?? null,
    registrationRequestedFields: parseRequestedFields(user.registrationRequestedFields),
    mobile: user.mobile ?? null,
    pendingMobile: user.pendingMobile ?? null,
    profilePhoto: currentPhoto ?? user.profilePhoto ?? null,
    pendingProfilePhoto: pendingPhoto ?? user.pendingProfilePhoto ?? null,
    registrationResubmittedAt: user.registrationResubmittedAt
      ? user.registrationResubmittedAt.toISOString()
      : null,
    registrationReviewedAt: user.registrationReviewedAt
      ? user.registrationReviewedAt.toISOString()
      : null
  };
}

export const registrationStatusService = {
  assertCanIssueSession,
  getRegistrationGate,
  requestRegistrationChanges,
  submitRegistrationCorrection,
  approveRegistration,
  rejectRegistration,
  toAdminRegistrationReview,
  parseRequestedFields
};
