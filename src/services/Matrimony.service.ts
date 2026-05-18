import { User, UserProfile, PendingProfileUpdate, MatrimonyRequestMeta } from "../models";
import type { MatrimonySection } from "../models/UserProfile.model";
import type { MatrimonyChangeRequestInfo } from "../models/MatrimonyRequestMeta.model";
import {
  MATRIMONY_REQUIRED_KEYS,
  MATRIMONY_SENSITIVE_KEYS
} from "../constants/matrimony.constants";
import { fieldsForChangeSections } from "../constants/matrimony-changes.constants";
import { normalizeJsonColumn, SECTION_ALLOWED_KEYS } from "./Profile.service";
import { toSignedUrlIfR2 } from "../utils/r2Client";
import { writeAudit } from "./MatrimonyAdmin.service";
import { computeFieldChanges } from "../utils/matrimonyChanges.util";
import {
  isMatrimonyForSelf,
  resolveCandidatePhotoUrl,
  syncMatrimonyPhotoFields,
  validateCandidatePhotoRules
} from "../constants/matrimony-photo.constants";

export type MatrimonyHubStatus =
  | "NOT_STARTED"
  | "DRAFT"
  | "PENDING"
  | "CHANGES_REQUESTED"
  | "RESUBMITTED"
  | "APPROVED"
  | "REJECTED";

export type MatrimonyHubResponse = {
  status: MatrimonyHubStatus;
  completion_percentage: number;
  can_browse: boolean;
  can_submit: boolean;
  missing_fields: string[];
  approved: MatrimonySection | null;
  draft: MatrimonySection | null;
  pending: {
    status: "PENDING" | "REJECTED" | "CHANGES_REQUESTED" | "RESUBMITTED";
    admin_remarks: string | null;
    change_request: MatrimonyChangeRequestInfo | null;
    requested_fields: string[];
    pending_update_id: number | null;
  } | null;
  user_context: {
    full_name: string;
    gender: string | null;
    date_of_birth: string | null;
    district: string | null;
    city: string | null;
    /** Social account profile photo only — not used as matrimony candidate for family profiles */
    profile_image: string | null;
    father_name: string | null;
    kulam: string | null;
  };
  /** Signed account owner photo for comparison UI */
  account_profile_photo: string | null;
  matrimony_candidate_photo: string | null;
  profile_for_self: boolean;
};

const SUBMITTED_FLAG = "_submittedForReview";
const CHANGE_REQUEST_KEY = "_changeRequest";
const SUBMISSION_SNAPSHOT_KEY = "_submissionSnapshot";
const RESUB_COUNT_KEY = "_resubmissionCount";

const INTERNAL_PENDING_KEYS = new Set([
  SUBMITTED_FLAG,
  CHANGE_REQUEST_KEY,
  SUBMISSION_SNAPSHOT_KEY,
  RESUB_COUNT_KEY
]);

function readRawPendingData(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

function isSubmittedPendingData(rawData: Record<string, unknown> | null): boolean {
  if (!rawData) return false;
  return rawData[SUBMITTED_FLAG] === true;
}

function stripInternalKeys(data: Record<string, unknown>): MatrimonySection {
  const allowed = SECTION_ALLOWED_KEYS.matrimony;
  const out: Record<string, unknown> = {};
  for (const k of allowed) {
    if (data[k] !== undefined) out[k] = data[k];
  }
  return out as MatrimonySection;
}

async function signMatrimonySection(section: MatrimonySection | null): Promise<MatrimonySection | null> {
  if (!section) return null;
  const out = { ...section } as Record<string, unknown>;
  for (const key of ["candidatePhotoUrl", "profilePhotoUrl", "horoscopeDocumentUrl"]) {
    const v = out[key];
    if (typeof v === "string" && v.trim()) {
      out[key] = (await toSignedUrlIfR2(v)) ?? v;
    }
  }
  return out as MatrimonySection;
}

function fieldFilled(key: string, value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return !Number.isNaN(value);
  if (typeof value === "boolean") return key === "matrimonyProfileActive" ? value === true : true;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Merge approved matrimony + in-progress pending draft for completion checks */
export function computeMatrimonyCompletion(
  approved: MatrimonySection | null,
  draft: MatrimonySection | null,
  userPhoto: string | null,
  requestedFieldsOnly?: string[] | null
): { percentage: number; missing: string[] } {
  const merged: Record<string, unknown> = syncMatrimonyPhotoFields({
    ...(approved ?? {}),
    ...(draft ?? {}),
    matrimonyProfileActive: true
  });

  const keysToCheck =
    requestedFieldsOnly && requestedFieldsOnly.length > 0
      ? MATRIMONY_REQUIRED_KEYS.filter((k) => requestedFieldsOnly.includes(k))
      : [...MATRIMONY_REQUIRED_KEYS];

  const missing: string[] = [];
  for (const key of keysToCheck) {
    if (key === "candidatePhotoUrl") {
      const hasCandidate = !!resolveCandidatePhotoUrl(merged);
      const useAccount =
        isMatrimonyForSelf(merged.lookingFor) && merged.useAccountProfilePhoto === true && !!userPhoto;
      if (!hasCandidate && !useAccount) missing.push(key);
      continue;
    }
    if (!fieldFilled(key, merged[key])) {
      missing.push(key);
    }
  }
  const total = keysToCheck.length || MATRIMONY_REQUIRED_KEYS.length;
  const filled = total - missing.length;
  const percentage = total > 0 ? Math.round((100 * filled) / total) : 0;
  return { percentage: Math.min(100, percentage), missing };
}

async function getUserContext(userId: number) {
  const user = await User.findByPk(userId);
  if (!user) throw new Error("User not found");
  const profile = await UserProfile.findOne({ where: { userId } });
  const community = normalizeJsonColumn(profile?.community, SECTION_ALLOWED_KEYS.community) as {
    kulam?: string | null;
  } | null;
  const personal = normalizeJsonColumn(profile?.personal, SECTION_ALLOWED_KEYS.personal) as {
    fatherName?: string | null;
  } | null;
  const profile_image = (await toSignedUrlIfR2(user.profilePhoto ?? null)) ?? user.profilePhoto ?? null;
  return {
    full_name: user.fullName,
    gender: user.gender ?? null,
    date_of_birth: user.dob ? String(user.dob).slice(0, 10) : null,
    district: user.district ?? null,
    city: user.city ?? null,
    profile_image,
    father_name: personal?.fatherName ?? null,
    kulam: community?.kulam ?? null
  };
}

const META_SAFE_ATTRIBUTES = [
  "id",
  "pendingUpdateId",
  "userId",
  "workflowStatus",
  "assignedReviewer",
  "reviewedBy",
  "rejectionReason",
  "rejectionComment",
  "verification",
  "suspended",
  "createdAt",
  "updatedAt"
] as const;

async function loadMeta(pendingUpdateId: number): Promise<MatrimonyRequestMeta | null> {
  try {
    return await MatrimonyRequestMeta.findOne({
      where: { pendingUpdateId },
      attributes: [...META_SAFE_ATTRIBUTES]
    });
  } catch {
    return null;
  }
}

/** Reopen legacy rows that were wrongly marked REJECTED for change requests */
async function reopenChangeRequestRow(row: PendingProfileUpdate): Promise<PendingProfileUpdate> {
  const raw = normalizeJsonColumn(row.data, SECTION_ALLOWED_KEYS.matrimony) ?? {};
  await row.update({
    status: "PENDING",
    reviewedAt: null,
    data: { ...raw, [SUBMITTED_FLAG]: false },
    updatedAt: new Date()
  } as any);
  return row;
}

/** Active matrimony application row (pending or reopened change-request) */
async function findActiveMatrimonyApplication(userId: number): Promise<{
  row: PendingProfileUpdate | null;
  meta: MatrimonyRequestMeta | null;
}> {
  let row = await PendingProfileUpdate.findOne({
    where: { userId, section: "MATRIMONY", status: "PENDING" },
    order: [["submittedAt", "DESC"]]
  });

  if (!row) {
    const last = await PendingProfileUpdate.findOne({
      where: { userId, section: "MATRIMONY" },
      order: [["submittedAt", "DESC"]]
    });
    if (last?.status === "REJECTED") {
      const meta = last ? await loadMeta(last.id) : null;
      if (
        meta?.workflowStatus === "CHANGES_REQUESTED" ||
        meta?.rejectionReason === "CHANGES_REQUESTED"
      ) {
        row = await reopenChangeRequestRow(last);
      }
    }
  }

  const meta = row ? await loadMeta(row.id) : null;
  return { row, meta };
}

export async function getMatrimonyHub(userId: number): Promise<MatrimonyHubResponse> {
  const [profileRow, { row: pendingRow, meta }, userContext] = await Promise.all([
    UserProfile.findOne({ where: { userId } }),
    findActiveMatrimonyApplication(userId),
    getUserContext(userId)
  ]);

  const approved = stripInternalKeys(
    normalizeJsonColumn(profileRow?.matrimony, SECTION_ALLOWED_KEYS.matrimony) ?? {}
  );
  const hasApproved = approved.matrimonyProfileActive === true;

  let draft: MatrimonySection | null = null;
  let pending: MatrimonyHubResponse["pending"] = null;

  if (pendingRow) {
    const rawFull = readRawPendingData(pendingRow.data);
    const raw = normalizeJsonColumn(pendingRow.data, SECTION_ALLOWED_KEYS.matrimony) ?? {};
    draft = await signMatrimonySection(stripInternalKeys(raw));

    const workflow = meta?.workflowStatus;
    const changeRequest =
      (rawFull[CHANGE_REQUEST_KEY] as MatrimonyChangeRequestInfo | undefined) ??
      meta?.changeRequest ??
      null;
    const resubCount = Number(rawFull[RESUB_COUNT_KEY] ?? meta?.resubmissionCount ?? 0);
    const requestedFields = changeRequest?.sections?.length
      ? fieldsForChangeSections(changeRequest.sections)
      : [];

    if (workflow === "CHANGES_REQUESTED" || (!isSubmittedPendingData(rawFull) && changeRequest)) {
      pending = {
        status: "CHANGES_REQUESTED",
        admin_remarks: pendingRow.adminRemarks ?? changeRequest?.comment ?? null,
        change_request: changeRequest,
        requested_fields: requestedFields,
        pending_update_id: pendingRow.id
      };
    } else if (isSubmittedPendingData(rawFull) && resubCount > 0) {
      pending = {
        status: "RESUBMITTED",
        admin_remarks: pendingRow.adminRemarks,
        change_request: changeRequest,
        requested_fields: requestedFields,
        pending_update_id: pendingRow.id
      };
    } else if (isSubmittedPendingData(rawFull)) {
      pending = {
        status: "PENDING",
        admin_remarks: pendingRow.adminRemarks,
        change_request: null,
        requested_fields: [],
        pending_update_id: pendingRow.id
      };
    }
  } else {
    const lastRow = await PendingProfileUpdate.findOne({
      where: { userId, section: "MATRIMONY" },
      order: [["submittedAt", "DESC"]]
    });
    if (lastRow?.status === "REJECTED") {
      const lastMeta = await loadMeta(lastRow.id);
      const isHardReject =
        lastMeta?.workflowStatus === "REJECTED" &&
        lastMeta?.rejectionReason !== "CHANGES_REQUESTED";
      if (isHardReject) {
        const raw = normalizeJsonColumn(lastRow.data, SECTION_ALLOWED_KEYS.matrimony) ?? {};
        draft = await signMatrimonySection(stripInternalKeys(raw));
        pending = {
          status: "REJECTED",
          admin_remarks: lastRow.adminRemarks,
          change_request: null,
          requested_fields: [],
          pending_update_id: lastRow.id
        };
      }
    }
  }

  const user = await User.findByPk(userId, { attributes: ["profilePhoto"] });
  const requestedFields = pending?.requested_fields?.length ? pending.requested_fields : null;
  const draftForCompletion = draft ?? (hasApproved ? null : approved);
  const { percentage, missing } = computeMatrimonyCompletion(
    hasApproved ? approved : null,
    draftForCompletion,
    user?.profilePhoto ?? null,
    pending?.status === "CHANGES_REQUESTED" ? requestedFields : null
  );

  let status: MatrimonyHubStatus = "NOT_STARTED";
  if (pending?.status === "CHANGES_REQUESTED") status = "CHANGES_REQUESTED";
  else if (pending?.status === "RESUBMITTED") status = "RESUBMITTED";
  else if (pending?.status === "PENDING") status = "PENDING";
  else if (pending?.status === "REJECTED") status = "REJECTED";
  else if (hasApproved) status = "APPROVED";
  else if (draft && Object.keys(draft).length > 0) status = "DRAFT";
  else if (percentage > 0) status = "DRAFT";

  const can_browse = hasApproved && status === "APPROVED";
  const can_submit =
    status === "CHANGES_REQUESTED" ||
    status === "DRAFT" ||
    status === "NOT_STARTED" ||
    status === "REJECTED"
      ? missing.length === 0
      : status !== "PENDING" && status !== "RESUBMITTED" && missing.length === 0;

  const profileForSelf = isMatrimonyForSelf(
    (draftForCompletion as MatrimonySection | null)?.lookingFor ?? approved?.lookingFor
  );
  const candidateRaw = resolveCandidatePhotoUrl(
    (draftForCompletion ?? approved ?? {}) as Record<string, unknown>
  );
  const candidateSigned = candidateRaw ? await toSignedUrlIfR2(candidateRaw) : null;

  return {
    status,
    completion_percentage: percentage,
    can_browse,
    can_submit,
    missing_fields: missing,
    approved: hasApproved ? await signMatrimonySection(approved) : null,
    draft,
    pending,
    user_context: userContext,
    account_profile_photo: userContext.profile_image,
    matrimony_candidate_photo: candidateSigned,
    profile_for_self: profileForSelf
  };
}

async function upsertMatrimonyPending(
  userId: number,
  payload: Record<string, unknown>,
  submittedForReview: boolean
): Promise<PendingProfileUpdate> {
  const allowedKeys = SECTION_ALLOWED_KEYS.matrimony;
  const { row: existingPending } = await findActiveMatrimonyApplication(userId);
  let existing = existingPending;

  if (!existing) {
    const rejected = await PendingProfileUpdate.findOne({
      where: { userId, section: "MATRIMONY", status: "REJECTED" },
      order: [["submittedAt", "DESC"]]
    });
    if (rejected) {
      const meta = await loadMeta(rejected.id);
      if (
        meta?.workflowStatus === "CHANGES_REQUESTED" ||
        meta?.rejectionReason === "CHANGES_REQUESTED"
      ) {
        existing = await reopenChangeRequestRow(rejected);
      }
    }
  }

  const rawFull = existing ? readRawPendingData(existing.data) : {};
  const existingData = normalizeJsonColumn(existing?.data, allowedKeys) ?? {};
  const merged = syncMatrimonyPhotoFields({
    ...rawFull,
    ...existingData,
    ...payload,
    [SUBMITTED_FLAG]: submittedForReview
  });
  const cleaned = Object.fromEntries(
    Object.entries(merged).filter(
      ([k, v]) => v !== undefined && (allowedKeys.has(k) || INTERNAL_PENDING_KEYS.has(k))
    )
  ) as Record<string, unknown>;

  if (existing) {
    await existing.update({ data: cleaned, submittedAt: new Date(), updatedAt: new Date() } as any);
    return existing;
  }
  return PendingProfileUpdate.create({
    userId,
    section: "MATRIMONY",
    data: cleaned,
    status: "PENDING",
    submittedAt: new Date(),
    reviewedAt: null,
    adminRemarks: null,
    createdAt: new Date(),
    updatedAt: new Date()
  } as any);
}

/** Save draft (not visible in admin queue until submit) */
export async function saveMatrimonyDraft(
  userId: number,
  payload: Record<string, unknown>
): Promise<MatrimonyHubResponse> {
  const hub = await getMatrimonyHub(userId);
  if (hub.status === "PENDING" || hub.status === "RESUBMITTED") {
    const err = new Error("Your profile is under admin review. Wait for approval or requested changes.");
    (err as any).status = 400;
    throw err;
  }

  const ctx = await getUserContext(userId);
  const merged = syncMatrimonyPhotoFields({
    ...(hub.draft ?? {}),
    ...payload,
    kulamSnapshot: payload.kulamSnapshot ?? ctx.kulam ?? null
  });
  await upsertMatrimonyPending(userId, merged, false);
  return getMatrimonyHub(userId);
}

/** Validate completion and queue for admin review (initial or resubmission) */
export async function submitMatrimonyProfile(
  userId: number,
  optionalPayload?: Record<string, unknown>
): Promise<MatrimonyHubResponse> {
  const hub = await getMatrimonyHub(userId);
  if (hub.status === "PENDING") {
    return {
      ...hub,
      message: "Your profile is already under admin review."
    } as MatrimonyHubResponse & { message?: string };
  }
  if (hub.status === "RESUBMITTED") {
    return {
      ...hub,
      message: "Your corrected profile is already resubmitted and awaiting review."
    } as MatrimonyHubResponse & { message?: string };
  }

  const ctx = await getUserContext(userId);
  const accountRow = await User.findByPk(userId, { attributes: ["profilePhoto"] });
  const accountPhotoRaw = accountRow?.profilePhoto?.trim() || null;

  let merged: Record<string, unknown> = syncMatrimonyPhotoFields({
    ...(hub.draft ?? {}),
    ...(optionalPayload ?? {}),
    matrimonyProfileActive: true,
    kulamSnapshot: optionalPayload?.kulamSnapshot ?? hub.draft?.kulamSnapshot ?? ctx.kulam ?? null
  });

  if (
    isMatrimonyForSelf(merged.lookingFor) &&
    merged.useAccountProfilePhoto === true &&
    !resolveCandidatePhotoUrl(merged) &&
    accountPhotoRaw
  ) {
    merged.candidatePhotoUrl = accountPhotoRaw;
    merged = syncMatrimonyPhotoFields(merged);
  }

  const photoCheck = validateCandidatePhotoRules(merged, accountPhotoRaw);
  if (!photoCheck.ok) {
    const err = new Error(photoCheck.message ?? "Matrimony candidate photo required");
    (err as any).status = 400;
    throw err;
  }

  const isResubmission = hub.status === "CHANGES_REQUESTED";
  const requestedFields = hub.pending?.requested_fields ?? null;

  const { missing } = computeMatrimonyCompletion(
    null,
    stripInternalKeys(merged),
    ctx.profile_image,
    isResubmission ? requestedFields : null
  );

  if (missing.length > 0) {
    const err = new Error(
      isResubmission
        ? `Please update the requested sections: ${missing.join(", ")}`
        : `Complete all required fields before submit: ${missing.join(", ")}`
    );
    (err as any).status = 400;
    (err as any).missing = missing;
    throw err;
  }

  if (merged.partnerAgeMin != null && merged.partnerAgeMax != null) {
    if (Number(merged.partnerAgeMin) > Number(merged.partnerAgeMax)) {
      const err = new Error("Partner age minimum cannot exceed maximum.");
      (err as any).status = 400;
      throw err;
    }
  }

  const row = await upsertMatrimonyPending(userId, merged, true);

  const rawFull = readRawPendingData(row.data);
  const profileData = stripInternalKeys(merged) as Record<string, unknown>;
  const priorSnapshot =
    (rawFull[SUBMISSION_SNAPSHOT_KEY] as Record<string, unknown> | undefined) ?? profileData;
  const snapshot = isResubmission ? priorSnapshot : profileData;
  const resubmissionCount = Number(rawFull[RESUB_COUNT_KEY] ?? 0) + (isResubmission ? 1 : 0);
  const changes = computeFieldChanges(snapshot, profileData);

  await row.update({
    data: {
      ...rawFull,
      ...profileData,
      [SUBMITTED_FLAG]: true,
      [SUBMISSION_SNAPSHOT_KEY]: snapshot,
      [RESUB_COUNT_KEY]: resubmissionCount
    },
    status: "PENDING",
    submittedAt: new Date(),
    updatedAt: new Date()
  } as any);

  const meta = await loadMeta(row.id);
  if (meta) {
    try {
      await meta.update({
        workflowStatus: "UNDER_REVIEW",
        updatedAt: new Date()
      } as any);
    } catch (err) {
      console.warn("[Matrimony] meta update on submit failed:", err instanceof Error ? err.message : err);
    }
  } else {
    try {
      await MatrimonyRequestMeta.create({
        pendingUpdateId: row.id,
        userId,
        workflowStatus: "UNDER_REVIEW",
        assignedReviewer: null,
        reviewedBy: null,
        rejectionReason: null,
        rejectionComment: null,
        verification: {},
        suspended: false
      } as any);
    } catch (err) {
      console.warn("[Matrimony] meta create on submit failed:", err instanceof Error ? err.message : err);
    }
  }

  await writeAudit(
    userId,
    row.id,
    isResubmission ? "RESUBMITTED" : "PROFILE_SUBMITTED",
    "user",
    { changes, resubmissionCount, submittedAt: new Date().toISOString() }
  ).catch(() => {});

  if (isResubmission) {
    await row.update({ adminRemarks: null } as any);
  }

  return getMatrimonyHub(userId);
}

/** After approved matrimony: changing photo/kulam/horoscope requires re-review */
export async function queueMatrimonyReReviewIfNeeded(
  userId: number,
  changedKeys: string[]
): Promise<void> {
  const profile = await UserProfile.findOne({ where: { userId } });
  const approved = stripInternalKeys(
    normalizeJsonColumn(profile?.matrimony, SECTION_ALLOWED_KEYS.matrimony) ?? {}
  );
  if (approved.matrimonyProfileActive !== true) return;

  const needs = changedKeys.some((k) =>
    (MATRIMONY_SENSITIVE_KEYS as readonly string[]).includes(k)
  );
  if (!needs) return;

  const pending = await PendingProfileUpdate.findOne({
    where: { userId, section: "MATRIMONY", status: "PENDING" }
  });
  if (pending && isSubmittedPendingData(normalizeJsonColumn(pending.data) ?? {})) return;

  await upsertMatrimonyPending(userId, { ...approved, matrimonyProfileActive: true }, true);
}

/**
 * Account profile photo changed — do NOT auto-copy to matrimony candidate photo
 * unless profile is for SELF and user opted in via useAccountProfilePhoto.
 */
export async function onUserProfilePhotoUpdated(userId: number, profilePhotoUrl: string | null): Promise<void> {
  const pending = await PendingProfileUpdate.findOne({
    where: { userId, section: "MATRIMONY", status: "PENDING" }
  });
  if (pending) {
    const raw = readRawPendingData(pending.data);
    const data = normalizeJsonColumn(pending.data, SECTION_ALLOWED_KEYS.matrimony) ?? {};
    if (
      isMatrimonyForSelf(data.lookingFor ?? raw.lookingFor) &&
      (data.useAccountProfilePhoto === true || raw.useAccountProfilePhoto === true)
    ) {
      await queueMatrimonyReReviewIfNeeded(userId, ["candidatePhotoUrl"]);
    }
    return;
  }
}
