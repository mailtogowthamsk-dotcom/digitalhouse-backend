import { Op, WhereOptions } from "sequelize";
import {
  User,
  UserProfile,
  PendingProfileUpdate,
  MatrimonyRequestMeta,
  MatrimonyAdminNote,
  MatrimonyReviewAudit,
  Kulam,
  Location
} from "../models";
import type { MatrimonyWorkflowStatus, MatrimonyVerificationState } from "../models/MatrimonyRequestMeta.model";
import type { MatrimonyNoteType } from "../models/MatrimonyAdminNote.model";
import { normalizeJsonColumn, SECTION_ALLOWED_KEYS } from "./Profile.service";
import { computeMatrimonyCompletion } from "./Matrimony.service";
import { approveProfileUpdate, rejectProfileUpdate } from "./admin.service";
import { toSignedUrlIfR2 } from "../utils/r2Client";
import {
  MATRIMONY_REJECTION_REASONS,
  MATRIMONY_VERIFICATION_KEYS,
  type MatrimonyVerificationKey
} from "../constants/matrimony-admin.constants";
import { computeFieldChanges } from "../utils/matrimonyChanges.util";
import { resolveCandidatePhotoUrl } from "../constants/matrimony-photo.constants";

const SUBMITTED_FLAG = "_submittedForReview";
const CHANGE_REQUEST_KEY = "_changeRequest";
const SUBMISSION_SNAPSHOT_KEY = "_submissionSnapshot";
const RESUB_COUNT_KEY = "_resubmissionCount";

/** Columns from base matrimony-admin-module.sql (works before changes-requested migration) */
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

async function loadMetaForPendingIds(ids: number[]): Promise<Map<number, MatrimonyRequestMeta>> {
  if (ids.length === 0) return new Map();
  try {
    const metas = await MatrimonyRequestMeta.findAll({
      where: { pendingUpdateId: ids },
      attributes: [...META_SAFE_ATTRIBUTES]
    });
    return new Map(metas.map((m) => [m.pendingUpdateId, m]));
  } catch (err) {
    console.warn(
      "[MatrimonyAdmin] matrimony_request_meta query failed — run migrations/matrimony-admin-module.sql",
      err instanceof Error ? err.message : err
    );
    return new Map();
  }
}

async function findOneMetaSafe(pendingUpdateId: number): Promise<MatrimonyRequestMeta | null> {
  try {
    return await MatrimonyRequestMeta.findOne({
      where: { pendingUpdateId },
      attributes: [...META_SAFE_ATTRIBUTES]
    });
  } catch {
    return null;
  }
}

export type MatrimonyRequestListQuery = {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  workflowStatus?: string;
  gender?: string;
  district?: string;
  kulam?: string;
  ageMin?: number;
  ageMax?: number;
  submittedFrom?: string;
  submittedTo?: string;
  completionMin?: number;
  verificationStatus?: "complete" | "incomplete" | "any";
  search?: string;
  includeDrafts?: boolean;
};

function calcAge(dob: Date | string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age;
}

function isVerificationComplete(v: MatrimonyVerificationState | null): boolean {
  if (!v) return false;
  return MATRIMONY_VERIFICATION_KEYS.every((k) => v[k]?.checked === true);
}

function deriveWorkflow(
  rowStatus: string,
  rawData: Record<string, unknown>,
  meta: MatrimonyRequestMeta | null
): MatrimonyWorkflowStatus {
  if (meta?.suspended) return "SUSPENDED";
  if (rowStatus === "APPROVED") return "APPROVED";
  if (rowStatus === "REJECTED") {
    return meta?.rejectionReason === "CHANGES_REQUESTED" || rawData[CHANGE_REQUEST_KEY]
      ? "CHANGES_REQUESTED"
      : "REJECTED";
  }
  const resubCount = Number(rawData[RESUB_COUNT_KEY] ?? 0);
  if (resubCount > 0 && rawData[SUBMITTED_FLAG] === true) return "RESUBMITTED";
  if (
    meta?.workflowStatus === "CHANGES_REQUESTED" ||
    (rawData[CHANGE_REQUEST_KEY] && rawData[SUBMITTED_FLAG] === false)
  ) {
    return "CHANGES_REQUESTED";
  }
  if (meta?.workflowStatus) return meta.workflowStatus;
  if (rawData[SUBMITTED_FLAG] === false) return "DRAFT";
  if (meta?.assignedReviewer) return "UNDER_REVIEW";
  return "SUBMITTED";
}

async function ensureMeta(
  pendingUpdateId: number,
  userId: number,
  data: Record<string, unknown>,
  rowStatus: string
): Promise<MatrimonyRequestMeta | null> {
  try {
    let meta = await findOneMetaSafe(pendingUpdateId);
    const workflow = deriveWorkflow(rowStatus, data, meta);
    if (!meta) {
      meta = await MatrimonyRequestMeta.create({
        pendingUpdateId,
        userId,
        workflowStatus: workflow,
        assignedReviewer: null,
        reviewedBy: null,
        rejectionReason: null,
        rejectionComment: null,
        verification: {},
        suspended: false
      } as any);
    }
    return meta;
  } catch (err) {
    console.warn(
      "[MatrimonyAdmin] matrimony_request_meta unavailable — run migrations/matrimony-admin-module.sql",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

const MATRIMONY_MEDIA_KEYS = ["candidatePhotoUrl", "profilePhotoUrl", "horoscopeDocumentUrl"] as const;

async function signMediaUrl(value: unknown): Promise<unknown> {
  if (typeof value !== "string" || !value.trim()) return value;
  return (await toSignedUrlIfR2(value)) ?? value;
}

async function signMatrimonyMedia(data: Record<string, unknown> | null): Promise<Record<string, unknown> | null> {
  if (!data) return null;
  const out = { ...data };
  for (const key of MATRIMONY_MEDIA_KEYS) {
    out[key] = await signMediaUrl(out[key]);
  }
  return out;
}

async function signFieldChangesMedia(
  changes: Array<{ field: string; oldValue: unknown; newValue: unknown }>
): Promise<Array<{ field: string; oldValue: unknown; newValue: unknown }>> {
  return Promise.all(
    changes.map(async (c) => {
      if (!MATRIMONY_MEDIA_KEYS.includes(c.field as (typeof MATRIMONY_MEDIA_KEYS)[number])) {
        return c;
      }
      return {
        field: c.field,
        oldValue: await signMediaUrl(c.oldValue),
        newValue: await signMediaUrl(c.newValue)
      };
    })
  );
}

async function signUserPhoto(url: string | null): Promise<string | null> {
  if (!url) return null;
  return (await toSignedUrlIfR2(url)) ?? url;
}

export async function writeAudit(
  userId: number,
  pendingUpdateId: number | null,
  action: string,
  createdBy: string,
  payload?: Record<string, unknown>
): Promise<void> {
  await MatrimonyReviewAudit.create({
    userId,
    pendingUpdateId,
    action,
    payload: payload ?? null,
    createdBy,
    createdAt: new Date()
  } as any);
}

export async function getMatrimonyAdminStats(): Promise<{
  pendingRequests: number;
  approvedProfiles: number;
  rejectedProfiles: number;
  underReview: number;
  newToday: number;
}> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [pendingRequests, approvedProfiles, rejectedProfiles, underReview, newToday] = await Promise.all([
    PendingProfileUpdate.count({ where: { section: "MATRIMONY", status: "PENDING" } }),
    PendingProfileUpdate.count({ where: { section: "MATRIMONY", status: "APPROVED" } }),
    PendingProfileUpdate.count({ where: { section: "MATRIMONY", status: "REJECTED" } }),
    MatrimonyRequestMeta.count({
      where: { workflowStatus: "UNDER_REVIEW", suspended: false },
      attributes: [...META_SAFE_ATTRIBUTES]
    }).catch(() => 0),
    PendingProfileUpdate.count({
      where: {
        section: "MATRIMONY",
        submittedAt: { [Op.gte]: startOfDay }
      }
    })
  ]);

  return { pendingRequests, approvedProfiles, rejectedProfiles, underReview, newToday };
}

export async function listMatrimonyRequests(query: MatrimonyRequestListQuery) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const sortBy = query.sortBy ?? "submittedAt";
  const sortDir = query.sortDir === "asc" ? "ASC" : "DESC";

  const rows = await PendingProfileUpdate.findAll({
    where: { section: "MATRIMONY" },
    order: [[sortBy === "submittedAt" ? "submittedAt" : "updatedAt", sortDir]],
    include: [{ model: User, as: "User", required: false }]
  });

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const [profiles, metaByPending] = await Promise.all([
    userIds.length > 0
      ? UserProfile.findAll({ where: { userId: userIds } })
      : Promise.resolve([]),
    loadMetaForPendingIds(rows.map((r) => r.id))
  ]);
  const profileByUser = new Map(profiles.map((p) => [p.userId, p]));

  const search = query.search?.trim().toLowerCase();
  const items: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const user = (row as any).User as User | undefined;
    const profile = profileByUser.get(row.userId);
    const allowedKeys = SECTION_ALLOWED_KEYS.matrimony;
    const rawData = readRawPendingData(row.data);
    const data = normalizeJsonColumn(row.data, allowedKeys) ?? {};
    const meta = metaByPending.get(row.id) ?? null;
    const workflowStatus = deriveWorkflow(row.status, rawData, meta);
    if (!query.includeDrafts && workflowStatus === "DRAFT") continue;
    if (query.workflowStatus && workflowStatus !== query.workflowStatus) continue;
    if (
      query.gender &&
      !(user?.gender ?? "").toLowerCase().includes(query.gender.toLowerCase())
    ) {
      continue;
    }

    const district = user?.district ?? "";
    if (query.district && !district.toLowerCase().includes(query.district.toLowerCase())) continue;

    const community = normalizeJsonColumn(profile?.community, SECTION_ALLOWED_KEYS.community) as {
      kulam?: string;
    } | null;
    const kulam =
      (data.kulamSnapshot as string) ?? community?.kulam ?? user?.kulam ?? "";
    if (query.kulam && !String(kulam).toLowerCase().includes(query.kulam.toLowerCase())) continue;

    const age = calcAge(user?.dob ?? null);
    if (query.ageMin != null && (age == null || age < query.ageMin)) continue;
    if (query.ageMax != null && (age == null || age > query.ageMax)) continue;

    if (query.submittedFrom) {
      const from = new Date(query.submittedFrom);
      if (row.submittedAt < from) continue;
    }
    if (query.submittedTo) {
      const to = new Date(query.submittedTo);
      to.setHours(23, 59, 59, 999);
      if (row.submittedAt > to) continue;
    }

    const approved = normalizeJsonColumn(profile?.matrimony, allowedKeys) ?? {};
    const { percentage } = computeMatrimonyCompletion(
      approved as any,
      data as any,
      user?.profilePhoto ?? null
    );
    if (query.completionMin != null && percentage < query.completionMin) continue;

    const verification = meta?.verification ?? null;
    const vComplete = isVerificationComplete(verification);
    if (query.verificationStatus === "complete" && !vComplete) continue;
    if (query.verificationStatus === "incomplete" && vComplete) continue;

    if (search) {
      const idMatch = String(row.id).includes(search) || String(row.userId).includes(search);
      const nameMatch = (user?.fullName ?? "").toLowerCase().includes(search);
      const mobileMatch = (user?.mobile ?? "").includes(search);
      const emailMatch = (user?.email ?? "").toLowerCase().includes(search);
      if (!idMatch && !nameMatch && !mobileMatch && !emailMatch) continue;
    }

    const candidateUrl = resolveCandidatePhotoUrl(data as Record<string, unknown>);
    const signedPhoto = candidateUrl ? await signUserPhoto(candidateUrl) : null;

    items.push({
      id: row.id,
      userId: row.userId,
      fullName: user?.fullName ?? `User #${row.userId}`,
      email: user?.email ?? "",
      mobile: user?.mobile ?? null,
      gender: user?.gender ?? null,
      age,
      district,
      kulam,
      submittedAt: row.submittedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      profileCompletion: percentage,
      workflowStatus,
      rowStatus: row.status,
      assignedReviewer: meta?.assignedReviewer ?? null,
      verificationComplete: vComplete,
      profilePhotoUrl: signedPhoto,
      submittedForReview: rawData[SUBMITTED_FLAG] !== false
    });
  }

  const total = items.length;
  const offset = (page - 1) * limit;
  const pageItems = items.slice(offset, offset + limit);

  return { items: pageItems, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
}

export async function getMatrimonyRequestDetail(updateId: number) {
  const row = await PendingProfileUpdate.findOne({
    where: { id: updateId, section: "MATRIMONY" },
    include: [{ model: User, as: "User", required: true }]
  });
  if (!row) throw Object.assign(new Error("Request not found"), { status: 404 });

  const user = (row as any).User as User;
  const profile = await UserProfile.findOne({ where: { userId: row.userId } });
  const allowedKeys = SECTION_ALLOWED_KEYS.matrimony;
  const rawData = readRawPendingData(row.data);
  const data = normalizeJsonColumn(row.data, allowedKeys) ?? {};
  const currentApproved = normalizeJsonColumn(profile?.matrimony, allowedKeys) ?? {};
  const community = normalizeJsonColumn(profile?.community, SECTION_ALLOWED_KEYS.community);
  const personal = normalizeJsonColumn(profile?.personal, SECTION_ALLOWED_KEYS.personal);
  const family = normalizeJsonColumn(profile?.family, SECTION_ALLOWED_KEYS.family);

  const meta = (await findOneMetaSafe(row.id)) ?? (await ensureMeta(row.id, row.userId, rawData, row.status));
  const workflowStatus = deriveWorkflow(row.status, rawData, meta);

  const pendingSigned = await signMatrimonyMedia(data);
  const approvedSigned = await signMatrimonyMedia(currentApproved as Record<string, unknown>);
  const accountOwnerPhoto = await signUserPhoto(user.profilePhoto ?? null);
  const candidateRaw = resolveCandidatePhotoUrl(data as Record<string, unknown>);
  const matrimonyCandidatePhoto = candidateRaw ? await signUserPhoto(candidateRaw) : null;
  const profileFor = String(data.lookingFor ?? "").toUpperCase();

  const { percentage, missing } = computeMatrimonyCompletion(
    currentApproved as any,
    data as any,
    user.profilePhoto ?? null
  );

  const [notes, audits, kulams, locations] = await Promise.all([
    MatrimonyAdminNote.findAll({
      where: { pendingUpdateId: row.id },
      order: [["createdAt", "DESC"]]
    }).catch(() => [] as MatrimonyAdminNote[]),
    MatrimonyReviewAudit.findAll({
      where: { userId: row.userId },
      order: [["createdAt", "DESC"]],
      limit: 50
    }).catch(() => [] as MatrimonyReviewAudit[]),
    Kulam.findAll({ attributes: ["id", "name"] }),
    Location.findAll({ attributes: ["id", "name"] })
  ]);

  const kulamMap = new Map(kulams.map((k) => [k.id, k.name]));
  const locationMap = new Map(locations.map((l) => [l.id, l.name]));
  const preferredDistricts = ((data.preferredDistrictIds as number[]) ?? []).map(
    (id) => locationMap.get(id) ?? String(id)
  );
  const preferredKulams = ((data.preferredKulamIds as number[]) ?? []).map(
    (id) => kulamMap.get(id) ?? String(id)
  );

  const snapshotRaw =
    (rawData[SUBMISSION_SNAPSHOT_KEY] as Record<string, unknown> | undefined) ??
    (meta?.submissionSnapshot as Record<string, unknown> | undefined) ??
    null;
  const submissionSnapshot = snapshotRaw ? await signMatrimonyMedia(snapshotRaw) : null;
  const fieldChanges = await signFieldChangesMedia(computeFieldChanges(snapshotRaw, data));
  const changeRequest =
    (rawData[CHANGE_REQUEST_KEY] as MatrimonyRequestMeta["changeRequest"]) ??
    meta?.changeRequest ??
    null;

  return {
    id: row.id,
    userId: user.id,
    workflowStatus,
    rowStatus: row.status,
    submittedAt: row.submittedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    adminRemarks: row.adminRemarks,
    submittedForReview: rawData[SUBMITTED_FLAG] !== false,
    profileCompletion: percentage,
    missingFields: missing,
    assignedReviewer: meta?.assignedReviewer ?? null,
    reviewedBy: meta?.reviewedBy ?? null,
    rejectionReason: meta?.rejectionReason ?? null,
    rejectionComment: meta?.rejectionComment ?? null,
    verification: meta?.verification ?? {},
    suspended: meta?.suspended ?? false,
    changeRequest,
    submissionSnapshot,
    fieldChanges,
    resubmissionCount: Number(rawData[RESUB_COUNT_KEY] ?? meta?.resubmissionCount ?? 0),
    user: {
      id: user.id,
      fullName: user.fullName,
      gender: user.gender,
      dob: user.dob ? String(user.dob).slice(0, 10) : null,
      age: calcAge(user.dob),
      mobile: user.mobile,
      email: user.email,
      district: user.district,
      city: user.city,
      profilePhoto: accountOwnerPhoto,
      accountOwnerPhoto,
      nativePlace: (community as any)?.nativeVillage ?? null,
      education: user.education,
      occupation: user.occupation,
      workLocation: user.workLocation
    },
    personal,
    community,
    family,
    matrimonyPending: pendingSigned,
    matrimonyApproved: approvedSigned,
    photoVerification: {
      profileFor,
      profileForSelf: profileFor === "SELF",
      useAccountProfilePhoto: data.useAccountProfilePhoto === true,
      candidatePhotoStatus: (data.candidatePhotoStatus as string) ?? null,
      accountOwnerPhoto,
      matrimonyCandidatePhoto
    },
    partnerPreferencesDisplay: {
      partnerAgeMin: data.partnerAgeMin,
      partnerAgeMax: data.partnerAgeMax,
      preferredDistricts,
      preferredKulams,
      partnerPreferences: data.partnerPreferences,
      dosham: data.dosham
    },
    notes: notes.map((n) => ({
      id: n.id,
      noteType: n.noteType,
      content: n.content,
      createdBy: n.createdBy,
      createdAt: n.createdAt.toISOString()
    })),
    auditLog: audits.map((a) => ({
      id: a.id,
      action: a.action,
      payload: a.payload,
      createdBy: a.createdBy,
      createdAt: a.createdAt.toISOString()
    })),
    rejectionReasons: MATRIMONY_REJECTION_REASONS
  };
}

export async function assignReviewer(updateId: number, reviewerEmail: string, adminEmail: string) {
  const row = await PendingProfileUpdate.findByPk(updateId);
  if (!row || row.section !== "MATRIMONY") throw Object.assign(new Error("Request not found"), { status: 404 });
  const data = normalizeJsonColumn(row.data, SECTION_ALLOWED_KEYS.matrimony) ?? {};
  const meta = await ensureMeta(row.id, row.userId, data, row.status);
  if (!meta) {
    const err = new Error("Matrimony admin tables not installed. Run matrimony-admin-module.sql migration.");
    (err as any).status = 503;
    throw err;
  }
  await meta.update({
    assignedReviewer: reviewerEmail,
    workflowStatus: "UNDER_REVIEW",
    updatedAt: new Date()
  } as any);
  await writeAudit(row.userId, row.id, "ASSIGNED_REVIEWER", adminEmail, { reviewerEmail });
}

export async function updateVerification(
  updateId: number,
  adminEmail: string,
  key: MatrimonyVerificationKey,
  checked: boolean
) {
  const row = await PendingProfileUpdate.findByPk(updateId);
  if (!row || row.section !== "MATRIMONY") throw Object.assign(new Error("Request not found"), { status: 404 });
  const data = normalizeJsonColumn(row.data, SECTION_ALLOWED_KEYS.matrimony) ?? {};
  const meta = await ensureMeta(row.id, row.userId, data, row.status);
  if (!meta) {
    const err = new Error("Matrimony admin tables not installed. Run matrimony-admin-module.sql migration.");
    (err as any).status = 503;
    throw err;
  }
  const verification: MatrimonyVerificationState = { ...(meta.verification ?? {}) };
  verification[key] = {
    checked,
    by: adminEmail,
    at: new Date().toISOString()
  };
  await meta.update({ verification, updatedAt: new Date() } as any);
  await writeAudit(row.userId, row.id, "VERIFICATION_UPDATED", adminEmail, { key, checked });
  return verification;
}

export async function addNote(
  updateId: number,
  adminEmail: string,
  content: string,
  noteType: MatrimonyNoteType
) {
  const row = await PendingProfileUpdate.findByPk(updateId);
  if (!row || row.section !== "MATRIMONY") throw Object.assign(new Error("Request not found"), { status: 404 });
  const note = await MatrimonyAdminNote.create({
    pendingUpdateId: row.id,
    userId: row.userId,
    noteType,
    content: content.trim(),
    createdBy: adminEmail,
    createdAt: new Date()
  } as any);
  await writeAudit(row.userId, row.id, "NOTE_ADDED", adminEmail, { noteType });
  return {
    id: note.id,
    noteType: note.noteType,
    content: note.content,
    createdBy: note.createdBy,
    createdAt: note.createdAt.toISOString()
  };
}

export async function approveMatrimonyRequest(updateId: number, adminEmail: string, remarks?: string) {
  const row = await PendingProfileUpdate.findByPk(updateId);
  if (!row || row.section !== "MATRIMONY") throw Object.assign(new Error("Request not found"), { status: 404 });
  await approveProfileUpdate(updateId, adminEmail, remarks ?? null);
  const data = normalizeJsonColumn(row.data, SECTION_ALLOWED_KEYS.matrimony) ?? {};
  const meta = await ensureMeta(row.id, row.userId, data, "APPROVED");
  if (meta) {
    await meta.update({
      workflowStatus: "APPROVED",
      reviewedBy: adminEmail,
      suspended: false,
      updatedAt: new Date()
    } as any);
  }
  await writeAudit(row.userId, row.id, "APPROVED", adminEmail, { remarks }).catch(() => {});
}

export async function rejectMatrimonyRequest(
  updateId: number,
  adminEmail: string,
  reasonCode: string,
  comment: string
) {
  const row = await PendingProfileUpdate.findByPk(updateId);
  if (!row || row.section !== "MATRIMONY") throw Object.assign(new Error("Request not found"), { status: 404 });
  const label =
    MATRIMONY_REJECTION_REASONS.find((r) => r.code === reasonCode)?.label ?? reasonCode;
  const remarks = `${label}${comment ? `: ${comment}` : ""}`;
  await rejectProfileUpdate(updateId, adminEmail, remarks);
  const data = normalizeJsonColumn(row.data, SECTION_ALLOWED_KEYS.matrimony) ?? {};
  const meta = await ensureMeta(row.id, row.userId, data, "REJECTED");
  if (meta) {
    await meta.update({
      workflowStatus: "REJECTED",
      reviewedBy: adminEmail,
      rejectionReason: reasonCode,
      rejectionComment: comment,
      updatedAt: new Date()
    } as any);
  }
  await writeAudit(row.userId, row.id, "REJECTED", adminEmail, { reasonCode, comment }).catch(() => {});
}

export async function requestMatrimonyChanges(
  updateId: number,
  adminEmail: string,
  comment: string,
  sections: string[] = []
) {
  const row = await PendingProfileUpdate.findByPk(updateId);
  if (!row || row.section !== "MATRIMONY") throw Object.assign(new Error("Request not found"), { status: 404 });
  if (row.status !== "PENDING") {
    const err = new Error("Only pending applications can receive change requests");
    (err as any).status = 400;
    throw err;
  }

  const allowedKeys = SECTION_ALLOWED_KEYS.matrimony;
  const rawFull = readRawPendingData(row.data);
  const data = normalizeJsonColumn(row.data, allowedKeys) ?? {};
  const snapshot = stripInternalKeysForSnapshot(data);

  const changeRequest = {
    comment,
    sections,
    requestedAt: new Date().toISOString(),
    requestedBy: adminEmail
  };

  await row.update({
    status: "PENDING",
    reviewedAt: null,
    adminRemarks: comment,
    data: {
      ...rawFull,
      ...data,
      [SUBMITTED_FLAG]: false,
      [CHANGE_REQUEST_KEY]: changeRequest,
      [SUBMISSION_SNAPSHOT_KEY]: snapshot
    },
    updatedAt: new Date()
  } as any);

  const meta = await ensureMeta(row.id, row.userId, rawFull, row.status);
  if (meta) {
    await meta.update({
      workflowStatus: "CHANGES_REQUESTED",
      reviewedBy: adminEmail,
      rejectionReason: "CHANGES_REQUESTED",
      rejectionComment: comment,
      updatedAt: new Date()
    } as any);
  }

  await writeAudit(row.userId, row.id, "CHANGES_REQUESTED", adminEmail, {
    comment,
    sections
  }).catch(() => {});
}

function stripInternalKeysForSnapshot(data: Record<string, unknown>): Record<string, unknown> {
  const allowed = SECTION_ALLOWED_KEYS.matrimony;
  const out: Record<string, unknown> = {};
  for (const k of allowed) {
    if (data[k] !== undefined) out[k] = data[k];
  }
  return out;
}

export async function suspendMatrimonyProfile(updateId: number, adminEmail: string, reason: string) {
  const row = await PendingProfileUpdate.findByPk(updateId);
  if (!row || row.section !== "MATRIMONY") throw Object.assign(new Error("Request not found"), { status: 404 });
  const data = normalizeJsonColumn(row.data, SECTION_ALLOWED_KEYS.matrimony) ?? {};
  const meta = await ensureMeta(row.id, row.userId, data, row.status);
  if (meta) {
    await meta.update({ suspended: true, workflowStatus: "SUSPENDED", reviewedBy: adminEmail } as any);
  }

  let profile = await UserProfile.findOne({ where: { userId: row.userId } });
  if (!profile) profile = await UserProfile.create({ userId: row.userId } as any);
  const matrimony = normalizeJsonColumn(profile.matrimony, SECTION_ALLOWED_KEYS.matrimony) ?? {};
  await profile.update({
    matrimony: { ...matrimony, matrimonyProfileActive: false, matrimonySuspended: true }
  } as any);
  await writeAudit(row.userId, row.id, "SUSPENDED", adminEmail, { reason });
}

export async function bulkMatrimonyAction(
  updateIds: number[],
  action: "approve" | "reject",
  adminEmail: string,
  rejectReason?: string,
  rejectComment?: string
) {
  const results: { id: number; ok: boolean; error?: string }[] = [];
  for (const id of updateIds) {
    try {
      if (action === "approve") {
        await approveMatrimonyRequest(id, adminEmail);
      } else {
        await rejectMatrimonyRequest(
          id,
          adminEmail,
          rejectReason ?? "OTHER",
          rejectComment ?? "Bulk rejection"
        );
      }
      results.push({ id, ok: true });
    } catch (e: any) {
      results.push({ id, ok: false, error: e.message ?? "Failed" });
    }
  }
  return results;
}
