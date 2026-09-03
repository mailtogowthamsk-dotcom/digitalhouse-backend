import { Op, Transaction } from "sequelize";
import { sequelize } from "../config/db";
import { ReferralCode, ReferralVerification, User } from "../models";
import {
  displayMemberId,
  INVALID_REFERRAL_CODE_MESSAGE,
  OPEN_REFERRAL_STATUSES,
  type ReferralDisplayStatus
} from "../constants/referral.constants";
import { audit } from "./platform/shared";
import {
  notifyReferralRejected,
  notifyReferralRequested,
  notifyReferralSubmitted
} from "./Notification.service";
import {
  canActAsReferrer,
  canAdminConfirm,
  canAdminRejectReferral,
  canAdminRequestReferral,
  canApplicantSubmitReferral,
  generateReferralCode,
  historicalReferrerUserId,
  isOpenReferralStatus,
  isValidReferralCodeFormat,
  normalizeReferralCode
} from "./referral/referralLogic";

const GENERIC_INVALID = INVALID_REFERRAL_CODE_MESSAGE;

function httpError(message: string, status: number, code?: string): Error {
  const err = new Error(message);
  (err as any).status = status;
  if (code) (err as any).code = code;
  return err;
}

type ResolvedReferral = {
  codeRow: ReferralCode;
  referrer: User;
};

async function findOpenVerification(
  applicantUserId: number,
  transaction?: Transaction
): Promise<ReferralVerification | null> {
  return ReferralVerification.findOne({
    where: {
      applicantUserId,
      status: { [Op.in]: [...OPEN_REFERRAL_STATUSES] }
    },
    order: [["id", "DESC"]],
    lock: transaction ? Transaction.LOCK.UPDATE : undefined,
    transaction
  });
}

async function latestVerification(applicantUserId: number): Promise<ReferralVerification | null> {
  return ReferralVerification.findOne({
    where: { applicantUserId },
    order: [["id", "DESC"]]
  });
}

export async function currentDisplayStatus(applicantUserId: number): Promise<ReferralDisplayStatus> {
  const open = await findOpenVerification(applicantUserId);
  if (open) return open.status;
  const latest = await latestVerification(applicantUserId);
  return latest?.status ?? "NOT_PROVIDED";
}

async function resolveUsableReferralCode(
  rawCode: string,
  applicantUserId: number,
  transaction?: Transaction
): Promise<ResolvedReferral> {
  const code = normalizeReferralCode(rawCode);
  if (!isValidReferralCodeFormat(code)) {
    throw httpError(GENERIC_INVALID, 400, "INVALID_REFERRAL_CODE");
  }

  const codeRow = await ReferralCode.findOne({
    where: { code, status: "ACTIVE" },
    lock: transaction ? Transaction.LOCK.UPDATE : undefined,
    transaction
  });
  if (!codeRow) {
    throw httpError(GENERIC_INVALID, 400, "INVALID_REFERRAL_CODE");
  }

  const referrer = await User.findByPk(codeRow.ownerUserId, { transaction });
  if (!referrer || !canActAsReferrer({ status: referrer.status, deletedAt: referrer.deletedAt })) {
    throw httpError(GENERIC_INVALID, 400, "INVALID_REFERRAL_CODE");
  }
  if (referrer.id === applicantUserId) {
    throw httpError(GENERIC_INVALID, 400, "INVALID_REFERRAL_CODE");
  }

  return { codeRow, referrer };
}

async function persistResolvedReferral(params: {
  applicantUserId: number;
  resolved: ResolvedReferral;
  existingOpen: ReferralVerification | null;
  transaction: Transaction;
}): Promise<ReferralVerification> {
  const now = new Date();
  const { resolved, existingOpen, applicantUserId, transaction } = params;
  const referrerUserId = resolved.referrer.id;

  if (existingOpen?.status === "PENDING_ADMIN_VERIFICATION") {
    throw httpError("A referral is already under admin review.", 409, "REFERRAL_ALREADY_SUBMITTED");
  }

  if (existingOpen?.status === "REQUESTED") {
    await existingOpen.update(
      {
        referrerUserId,
        referralCodeId: resolved.codeRow.id,
        referralCodeSnapshot: resolved.codeRow.code,
        status: "PENDING_ADMIN_VERIFICATION",
        submittedAt: now
      },
      { transaction }
    );
    return existingOpen;
  }

  return ReferralVerification.create(
    {
      applicantUserId,
      referrerUserId,
      referralCodeId: resolved.codeRow.id,
      referralCodeSnapshot: resolved.codeRow.code,
      status: "PENDING_ADMIN_VERIFICATION",
      submittedAt: now
    } as any,
    { transaction }
  );
}

/** Validate a code without persisting — used so registration can fail before User.create. */
export async function assertUsableReferralCode(rawCode: string, applicantUserId = 0): Promise<void> {
  await resolveUsableReferralCode(rawCode, applicantUserId);
}

/** Registration / Google complete: optional code. Empty = skip. Invalid = fail. */
export async function attachReferralCodeAtRegistration(
  applicantUserId: number,
  rawCode: string | null | undefined
): Promise<void> {
  const trimmed = String(rawCode ?? "").trim();
  if (!trimmed) return;

  await sequelize.transaction(async (transaction) => {
    const open = await findOpenVerification(applicantUserId, transaction);
    const resolved = await resolveUsableReferralCode(trimmed, applicantUserId, transaction);
    const row = await persistResolvedReferral({
      applicantUserId,
      resolved,
      existingOpen: open,
      transaction
    });
    await audit(null, "referral.submitted", "referral", {
      applicantUserId,
      referrerUserId: historicalReferrerUserId(row),
      referralCodeSnapshot: row.referralCodeSnapshot,
      source: "registration"
    });
  });
}

export async function submitReferralCode(applicantUserId: number, rawCode: string): Promise<{ status: ReferralDisplayStatus }> {
  const applicant = await User.findByPk(applicantUserId);
  if (!applicant) throw httpError("User not found", 404);

  const current = await currentDisplayStatus(applicantUserId);
  if (!canApplicantSubmitReferral({ applicantStatus: applicant.status, currentReferralStatus: current })) {
    throw httpError("You cannot submit a referral code at this time.", 400, "REFERRAL_NOT_ALLOWED");
  }

  const row = await sequelize.transaction(async (transaction) => {
    const open = await findOpenVerification(applicantUserId, transaction);
    if (open?.status === "PENDING_ADMIN_VERIFICATION") {
      throw httpError("A referral is already under admin review.", 409, "REFERRAL_ALREADY_SUBMITTED");
    }
    const resolved = await resolveUsableReferralCode(rawCode, applicantUserId, transaction);
    return persistResolvedReferral({
      applicantUserId,
      resolved,
      existingOpen: open,
      transaction
    });
  });

  await audit(null, "referral.submitted", "referral", {
    applicantUserId,
    referrerUserId: historicalReferrerUserId(row),
    referralVerificationId: row.id,
    referralCodeSnapshot: row.referralCodeSnapshot
  });
  void notifyReferralSubmitted(applicantUserId).catch(() => undefined);

  return { status: row.status };
}

export async function requestReferral(params: {
  applicantUserId: number;
  adminEmail: string;
  note?: string | null;
  skipNotify?: boolean;
}): Promise<{ status: ReferralDisplayStatus }> {
  const applicant = await User.findByPk(params.applicantUserId);
  if (!applicant) throw httpError("User not found", 404);

  const current = await currentDisplayStatus(params.applicantUserId);
  if (
    !canAdminRequestReferral({
      applicantStatus: applicant.status,
      currentReferralStatus: current
    })
  ) {
    throw httpError("Referral cannot be requested in the current state.", 400, "REFERRAL_REQUEST_INVALID");
  }

  const now = new Date();
  const note =
    params.note?.trim() ||
    "Please provide a referral code from an existing Digital House member known to you.";

  const row = await sequelize.transaction(async (transaction) => {
    const open = await findOpenVerification(params.applicantUserId, transaction);
    if (open?.status === "REQUESTED") {
      await open.update(
        {
          requestedAt: now,
          requestedByAdmin: params.adminEmail,
          adminNotes: note
        },
        { transaction }
      );
      return open;
    }
    if (open) {
      throw httpError("An active referral already exists.", 409, "REFERRAL_ACTIVE");
    }
    return ReferralVerification.create(
      {
        applicantUserId: params.applicantUserId,
        referrerUserId: null,
        referralCodeId: null,
        referralCodeSnapshot: null,
        status: "REQUESTED",
        requestedAt: now,
        requestedByAdmin: params.adminEmail,
        adminNotes: note
      } as any,
      { transaction }
    );
  });

  await audit(params.adminEmail, "referral.requested", "referral", {
    applicantUserId: params.applicantUserId,
    referralVerificationId: row.id
  });
  if (!params.skipNotify) {
    void notifyReferralRequested(params.applicantUserId).catch(() => undefined);
  }
  return { status: row.status };
}

export async function confirmReferral(params: {
  applicantUserId: number;
  adminEmail: string;
  note?: string | null;
}): Promise<{ status: ReferralDisplayStatus }> {
  const row = await sequelize.transaction(async (transaction) => {
    const open = await findOpenVerification(params.applicantUserId, transaction);
    if (!open || !canAdminConfirm(open.status) || !open.referrerUserId) {
      throw httpError("No submitted referral to confirm.", 400, "REFERRAL_CONFIRM_INVALID");
    }
    await open.update(
      {
        status: "CONFIRMED",
        verifiedAt: new Date(),
        verifiedByAdmin: params.adminEmail,
        adminNotes: params.note?.trim() || open.adminNotes
      },
      { transaction }
    );
    return open;
  });

  await audit(params.adminEmail, "referral.confirmed", "referral", {
    applicantUserId: params.applicantUserId,
    referrerUserId: historicalReferrerUserId(row),
    referralVerificationId: row.id
  });
  return { status: row.status };
}

export async function rejectReferral(params: {
  applicantUserId: number;
  adminEmail: string;
  note?: string | null;
}): Promise<{ status: ReferralDisplayStatus }> {
  const row = await sequelize.transaction(async (transaction) => {
    const open = await findOpenVerification(params.applicantUserId, transaction);
    if (!open || !canAdminRejectReferral(open.status)) {
      throw httpError("No submitted referral to reject.", 400, "REFERRAL_REJECT_INVALID");
    }
    await open.update(
      {
        status: "REJECTED",
        rejectedAt: new Date(),
        rejectedByAdmin: params.adminEmail,
        adminNotes: params.note?.trim() || open.adminNotes
      },
      { transaction }
    );
    return open;
  });

  await audit(params.adminEmail, "referral.rejected", "referral", {
    applicantUserId: params.applicantUserId,
    referrerUserId: historicalReferrerUserId(row),
    referralVerificationId: row.id
  });
  void notifyReferralRejected(params.applicantUserId).catch(() => undefined);
  return { status: row.status };
}

async function ensureUniqueCode(): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const code = generateReferralCode();
    const exists = await ReferralCode.findOne({ where: { code } });
    if (!exists) return code;
  }
  throw httpError("Could not generate a unique referral code. Please try again.", 500);
}

export async function getOrCreateOwnReferralCode(ownerUserId: number): Promise<{
  code: string;
  memberDisplayId: string;
}> {
  const owner = await User.findByPk(ownerUserId);
  if (!owner || !canActAsReferrer({ status: owner.status, deletedAt: owner.deletedAt })) {
    throw httpError("Referral codes are available only for approved members.", 403, "REFERRAL_CODE_UNAVAILABLE");
  }

  let row = await ReferralCode.findOne({ where: { ownerUserId } });
  if (!row) {
    const code = await ensureUniqueCode();
    try {
      row = await ReferralCode.create({
        ownerUserId,
        code,
        status: "ACTIVE"
      } as any);
      await audit(null, "referral.code_generated", "referral", { ownerUserId, referrerUserId: ownerUserId });
    } catch (e: any) {
      if (e?.name === "SequelizeUniqueConstraintError") {
        row = await ReferralCode.findOne({ where: { ownerUserId } });
      } else {
        throw e;
      }
    }
  }
  if (!row) throw httpError("Could not load referral code.", 500);
  return { code: row.code, memberDisplayId: displayMemberId(ownerUserId) };
}

export async function regenerateOwnReferralCode(ownerUserId: number): Promise<{
  code: string;
  memberDisplayId: string;
}> {
  const owner = await User.findByPk(ownerUserId);
  if (!owner || !canActAsReferrer({ status: owner.status, deletedAt: owner.deletedAt })) {
    throw httpError("Referral codes are available only for approved members.", 403, "REFERRAL_CODE_UNAVAILABLE");
  }

  const row = await ReferralCode.findOne({ where: { ownerUserId } });
  const next = await ensureUniqueCode();
  if (!row) {
    await ReferralCode.create({ ownerUserId, code: next, status: "ACTIVE" } as any);
  } else {
    await row.update({ code: next, status: "ACTIVE" });
  }

  await audit(null, "referral.code_regenerated", "referral", { ownerUserId, referrerUserId: ownerUserId });
  return { code: next, memberDisplayId: displayMemberId(ownerUserId) };
}

export async function getOwnReferralStatus(applicantUserId: number): Promise<{
  status: ReferralDisplayStatus;
  canSubmit: boolean;
  adminNote: string | null;
}> {
  const applicant = await User.findByPk(applicantUserId);
  const status = await currentDisplayStatus(applicantUserId);
  const latest = await latestVerification(applicantUserId);
  const canSubmit = applicant
    ? canApplicantSubmitReferral({ applicantStatus: applicant.status, currentReferralStatus: status })
    : false;
  return {
    status,
    canSubmit,
    adminNote: status === "REQUESTED" ? latest?.adminNotes ?? null : null
  };
}

function toAdminAttempt(
  row: ReferralVerification,
  referrers: Map<number, User>
) {
  const referrer = row.referrerUserId ? referrers.get(row.referrerUserId) ?? null : null;
  return {
    id: row.id,
    status: row.status,
    referrerUserId: historicalReferrerUserId(row),
    referredBy: referrer?.fullName ?? null,
    memberDisplayId: row.referrerUserId ? displayMemberId(row.referrerUserId) : null,
    referrerStatus: referrer?.status ?? null,
    referralCodeUsed: row.referralCodeSnapshot,
    requestedAt: row.requestedAt?.toISOString() ?? null,
    requestedByAdmin: row.requestedByAdmin,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    verifiedByAdmin: row.verifiedByAdmin,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    rejectedByAdmin: row.rejectedByAdmin,
    adminNotes: row.adminNotes
  };
}

export async function getAdminReferralPayload(applicantUserId: number) {
  const applicant = await User.findByPk(applicantUserId);
  if (!applicant) return null;

  const historyRows = await ReferralVerification.findAll({
    where: { applicantUserId },
    order: [["id", "DESC"]],
    limit: 50
  });
  const referrerIds = [
    ...new Set(historyRows.map((r) => r.referrerUserId).filter((id): id is number => typeof id === "number"))
  ];
  const referrerList = referrerIds.length
    ? await User.findAll({ where: { id: { [Op.in]: referrerIds } } })
    : [];
  const referrers = new Map(referrerList.map((u) => [u.id, u]));
  const open = historyRows.find((r) => isOpenReferralStatus(r.status)) ?? null;
  const currentRow = open ?? historyRows[0] ?? null;
  const currentStatus: ReferralDisplayStatus = currentRow?.status ?? "NOT_PROVIDED";

  const history = historyRows.map((row) => toAdminAttempt(row, referrers));
  const current = currentRow ? toAdminAttempt(currentRow, referrers) : null;

  return {
    registrationStatus: applicant.status,
    currentStatus,
    current,
    history,
    actions: {
      canRequest: canAdminRequestReferral({
        applicantStatus: applicant.status,
        currentReferralStatus: currentStatus
      }),
      canConfirm: currentRow ? canAdminConfirm(currentRow.status) : false,
      canRejectReferral: currentRow ? canAdminRejectReferral(currentRow.status) : false,
      viewReferrerUserId: currentRow?.referrerUserId ?? null
    }
  };
}

export const referralService = {
  assertUsableReferralCode,
  attachReferralCodeAtRegistration,
  submitReferralCode,
  requestReferral,
  confirmReferral,
  rejectReferral,
  getOrCreateOwnReferralCode,
  regenerateOwnReferralCode,
  getOwnReferralStatus,
  getAdminReferralPayload
};
