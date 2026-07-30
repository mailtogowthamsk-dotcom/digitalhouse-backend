import { Op, WhereOptions } from "sequelize";
import {
  User,
  UserProfile,
  PendingProfileUpdate,
  MatrimonyRequestMeta,
  MatrimonyAdminNote,
  MatrimonyReviewAudit,
  MatrimonyInterest,
  MatrimonyMatch,
  MatrimonyReport,
  MatrimonySubscription,
  Kulam,
  Location
} from "../models";
import { ensureUserProfile } from "./ensureUserProfile";
import type { MatrimonyWorkflowStatus, MatrimonyVerificationState } from "../models/MatrimonyRequestMeta.model";
import type { MatrimonyNoteType } from "../models/MatrimonyAdminNote.model";
import { normalizeJsonColumn, SECTION_ALLOWED_KEYS } from "./Profile.service";
import { computeMatrimonyCompletion } from "./Matrimony.service";
import { approveProfileUpdate, rejectProfileUpdate } from "./admin.service";
import { toPublicUrlIfR2, toPrivateSignedUrlIfR2 } from "../utils/r2Client";
import {
  MATRIMONY_REJECTION_REASONS,
  MATRIMONY_VERIFICATION_KEYS,
  type MatrimonyVerificationKey
} from "../constants/matrimony-admin.constants";
import { computeFieldChanges } from "../utils/matrimonyChanges.util";
import {
  resolveCandidatePhotoUrl,
  syncMatrimonyPhotoFields,
  type MatrimonyCandidatePhotoStatus
} from "../constants/matrimony-photo.constants";

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
  community?: string;
  ageMin?: number;
  ageMax?: number;
  submittedFrom?: string;
  submittedTo?: string;
  /** today | week | month — convenience date windows on current application */
  period?: "today" | "week" | "month";
  completionMin?: number;
  verificationStatus?: "complete" | "incomplete" | "any";
  search?: string;
  includeDrafts?: boolean;
  /** When true, show SUBMITTED, UNDER_REVIEW, and RESUBMITTED only */
  pendingReviewOnly?: boolean;
  subscriptionPlan?: string;
  versionMin?: number;
};

/** Prefer an open PENDING application; otherwise the latest by submittedAt. */
function pickCurrentApplication<
  T extends { rowStatus: string; submittedAt: string; updatedAt: string }
>(apps: T[]): T {
  const pending = apps.filter((a) => a.rowStatus === "PENDING");
  const pool = pending.length > 0 ? pending : apps;
  return [...pool].sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
  )[0];
}

function periodRange(period?: string): { from?: Date; to?: Date } {
  if (!period) return {};
  const now = new Date();
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  if (period === "week") {
    from.setDate(from.getDate() - 7);
  } else if (period === "month") {
    from.setDate(1);
  } else if (period !== "today") {
    return {};
  }
  return { from, to };
}

function adminDecisionLabel(workflowStatus: string, reviewedBy: string | null): string {
  if (workflowStatus === "APPROVED") return reviewedBy ? `Approved by ${reviewedBy}` : "Approved";
  if (workflowStatus === "REJECTED") return reviewedBy ? `Rejected by ${reviewedBy}` : "Rejected";
  if (workflowStatus === "CHANGES_REQUESTED") {
    return reviewedBy ? `Changes requested by ${reviewedBy}` : "Changes requested";
  }
  if (workflowStatus === "SUSPENDED") return "Suspended";
  if (workflowStatus === "UNDER_REVIEW") return reviewedBy ? `Under review (${reviewedBy})` : "Under review";
  return "—";
}

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

function publicMediaUrl(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) return value;
  return toPublicUrlIfR2(value) ?? value;
}

async function signMatrimonyMedia(data: Record<string, unknown> | null): Promise<Record<string, unknown> | null> {
  if (!data) return null;
  const out = { ...data };
  for (const key of MATRIMONY_MEDIA_KEYS) {
    out[key] =
      key === "horoscopeDocumentUrl"
        ? await toPrivateSignedUrlIfR2(
            typeof out[key] === "string" ? (out[key] as string) : null
          )
        : publicMediaUrl(out[key]);
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
        oldValue:
          c.field === "horoscopeDocumentUrl"
            ? await toPrivateSignedUrlIfR2(
                typeof c.oldValue === "string" ? c.oldValue : null
              )
            : publicMediaUrl(c.oldValue),
        newValue:
          c.field === "horoscopeDocumentUrl"
            ? await toPrivateSignedUrlIfR2(
                typeof c.newValue === "string" ? c.newValue : null
              )
            : publicMediaUrl(c.newValue)
      };
    })
  );
}

function publicUserPhoto(url: string | null): string | null {
  if (!url) return null;
  return toPublicUrlIfR2(url) ?? url;
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
  totalInterests: number;
  mutualMatches: number;
  pendingReports: number;
}> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [
    pendingRows,
    approvedProfiles,
    rejectedProfiles,
    underReview,
    newToday,
    totalInterests,
    mutualMatches,
    pendingReports
  ] = await Promise.all([
    PendingProfileUpdate.findAll({
      where: { section: "MATRIMONY", status: "PENDING" },
      attributes: ["id", "data"]
    }),
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
    }),
    MatrimonyInterest.count().catch(() => 0),
    MatrimonyMatch.count().catch(() => 0),
    MatrimonyReport.count({ where: { status: "PENDING" } }).catch(() => 0)
  ]);

  // Align with Needs-review queue: exclude unsubmitted drafts.
  const pendingRequests = pendingRows.filter((row) => {
    const raw = readRawPendingData(row.data);
    return raw[SUBMITTED_FLAG] !== false;
  }).length;

  return {
    pendingRequests,
    approvedProfiles,
    rejectedProfiles,
    underReview,
    newToday,
    totalInterests,
    mutualMatches,
    pendingReports
  };
}

export async function listMatrimonyRequests(query: MatrimonyRequestListQuery) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const sortBy = query.sortBy ?? "submittedAt";
  const sortDir = query.sortDir === "asc" ? "ASC" : "DESC";

  const pendingWhere: WhereOptions = { section: "MATRIMONY" };
  const period = periodRange(query.period);
  const submittedFrom = query.submittedFrom || (period.from ? period.from.toISOString() : undefined);
  const submittedTo = query.submittedTo || (period.to ? period.to.toISOString() : undefined);

  const userWhere: WhereOptions = {};
  if (query.gender?.trim()) {
    (userWhere as any).gender = { [Op.like]: `%${query.gender.trim()}%` };
  }
  if (query.district?.trim()) {
    (userWhere as any).district = { [Op.like]: `%${query.district.trim()}%` };
  }
  if (query.community?.trim()) {
    (userWhere as any).community = { [Op.like]: `%${query.community.trim()}%` };
  }
  const hasUserFilter = Object.keys(userWhere).length > 0;

  const rows = await PendingProfileUpdate.findAll({
    where: pendingWhere,
    order: [["submittedAt", "ASC"]],
    include: [
      {
        model: User,
        as: "User",
        required: true,
        where: hasUserFilter ? userWhere : undefined
      }
    ]
  });

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const [profiles, metaByPending] = await Promise.all([
    userIds.length > 0
      ? UserProfile.findAll({ where: { userId: userIds } })
      : Promise.resolve([]),
    loadMetaForPendingIds(rows.map((r) => r.id))
  ]);
  const profileByUser = new Map(profiles.map((p) => [p.userId, p]));

  type BuiltItem = {
    id: number;
    userId: number;
    fullName: string;
    email: string;
    mobile: string | null;
    gender: string | null;
    age: number | null;
    district: string;
    community: string;
    kulam: string;
    submittedAt: string;
    updatedAt: string;
    profileCompletion: number;
    workflowStatus: MatrimonyWorkflowStatus;
    rowStatus: string;
    assignedReviewer: string | null;
    reviewedBy: string | null;
    verificationComplete: boolean;
    profilePhotoUrl: string | null;
    submittedForReview: boolean;
    adminDecision: string;
    applicationVersion: number;
    applicationCount: number;
    isCurrent: boolean;
    subscriptionPlan: string | null;
    _candidateUrl?: string | null;
  };

  const byUser = new Map<number, BuiltItem[]>();

  for (const row of rows) {
    const u = (row as any).User as User;

    const profile = profileByUser.get(row.userId);
    const allowedKeys = SECTION_ALLOWED_KEYS.matrimony;
    const rawData = readRawPendingData(row.data);
    const data = normalizeJsonColumn(row.data, allowedKeys) ?? {};
    const meta = metaByPending.get(row.id) ?? null;
    const workflowStatus = deriveWorkflow(row.status, rawData, meta);

    if (
      query.gender &&
      !(u.gender ?? "").toLowerCase().includes(query.gender.toLowerCase())
    ) {
      continue;
    }

    const district = u.district ?? "";
    if (query.district && !district.toLowerCase().includes(query.district.toLowerCase())) continue;

    const communityName = u.community ?? "";
    if (
      query.community &&
      !communityName.toLowerCase().includes(query.community.toLowerCase())
    ) {
      continue;
    }

    const community = normalizeJsonColumn(profile?.community, SECTION_ALLOWED_KEYS.community) as {
      kulam?: string;
    } | null;
    const kulam =
      (data.kulamSnapshot as string) ?? community?.kulam ?? u.kulam ?? "";
    if (query.kulam && !String(kulam).toLowerCase().includes(query.kulam.toLowerCase())) continue;

    const age = calcAge(u.dob ?? null);
    if (query.ageMin != null && (age == null || age < query.ageMin)) continue;
    if (query.ageMax != null && (age == null || age > query.ageMax)) continue;

    const approved = normalizeJsonColumn(profile?.matrimony, allowedKeys) ?? {};
    const { percentage } = computeMatrimonyCompletion(
      approved as any,
      data as any,
      u.profilePhoto ?? null
    );
    if (query.completionMin != null && percentage < query.completionMin) continue;

    const verification = meta?.verification ?? null;
    const vComplete = isVerificationComplete(verification);
    if (query.verificationStatus === "complete" && !vComplete) continue;
    if (query.verificationStatus === "incomplete" && vComplete) continue;

    const search = query.search?.trim().toLowerCase();
    if (search) {
      const idMatch = String(row.id).includes(search) || String(row.userId).includes(search);
      const nameMatch = (u.fullName ?? "").toLowerCase().includes(search);
      const mobileMatch = (u.mobile ?? "").includes(search);
      const emailMatch = (u.email ?? "").toLowerCase().includes(search);
      const communityMatch = communityName.toLowerCase().includes(search);
      const kulamMatch = String(kulam).toLowerCase().includes(search);
      const districtMatch = district.toLowerCase().includes(search);
      if (
        !idMatch &&
        !nameMatch &&
        !mobileMatch &&
        !emailMatch &&
        !communityMatch &&
        !kulamMatch &&
        !districtMatch
      ) {
        continue;
      }
    }

    const candidateUrl = resolveCandidatePhotoUrl(data as Record<string, unknown>);
    const reviewedBy = meta?.reviewedBy ?? null;

    const item: BuiltItem = {
      id: row.id,
      userId: row.userId,
      fullName: u.fullName ?? `User #${row.userId}`,
      email: u.email ?? "",
      mobile: u.mobile ?? null,
      gender: u.gender ?? null,
      age,
      district,
      community: communityName,
      kulam: String(kulam),
      submittedAt: row.submittedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      profileCompletion: percentage,
      workflowStatus,
      rowStatus: row.status,
      assignedReviewer: meta?.assignedReviewer ?? null,
      reviewedBy,
      verificationComplete: vComplete,
      profilePhotoUrl: null,
      submittedForReview: rawData[SUBMITTED_FLAG] !== false,
      adminDecision: adminDecisionLabel(workflowStatus, reviewedBy),
      applicationVersion: 0,
      applicationCount: 0,
      isCurrent: false,
      subscriptionPlan: null,
      _candidateUrl: candidateUrl
    };

    const list = byUser.get(row.userId) ?? [];
    list.push(item);
    byUser.set(row.userId, list);
  }

  // Assign version numbers (chronological) and pick ONE current row per user
  let currentItems: BuiltItem[] = [];
  for (const [, apps] of byUser) {
    const chron = [...apps].sort(
      (a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
    );
    chron.forEach((a, idx) => {
      a.applicationVersion = idx + 1;
      a.applicationCount = chron.length;
    });
    const current = pickCurrentApplication(chron);
    current.isCurrent = true;
    currentItems.push(current);
  }

  // Status / draft / date filters apply to the CURRENT application only
  currentItems = currentItems.filter((item) => {
    if (!query.includeDrafts && item.workflowStatus === "DRAFT") return false;
    if (query.workflowStatus) {
      if (item.workflowStatus !== query.workflowStatus) return false;
    } else if (query.pendingReviewOnly) {
      const pending = new Set(["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED"]);
      if (!pending.has(item.workflowStatus)) return false;
    }
    if (submittedFrom) {
      const from = new Date(submittedFrom);
      if (!Number.isNaN(from.getTime()) && new Date(item.submittedAt) < from) return false;
    }
    if (submittedTo) {
      const to = new Date(submittedTo);
      if (!Number.isNaN(to.getTime()) && new Date(item.submittedAt) > to) return false;
    }
    if (query.versionMin != null && item.applicationVersion < query.versionMin) return false;
    return true;
  });

  // Optional subscription plan filter
  if (query.subscriptionPlan?.trim() && currentItems.length > 0) {
    const ids = currentItems.map((i) => i.userId);
    const subs = await MatrimonySubscription.findAll({
      where: { userId: { [Op.in]: ids }, status: "ACTIVE" },
      attributes: ["userId", "plan"]
    }).catch(() => [] as MatrimonySubscription[]);
    const planByUser = new Map(subs.map((s) => [s.userId, s.plan]));
    const want = query.subscriptionPlan.trim().toUpperCase();
    currentItems = currentItems.filter((i) => (planByUser.get(i.userId) ?? "FREE") === want);
    for (const i of currentItems) {
      i.subscriptionPlan = planByUser.get(i.userId) ?? "FREE";
    }
  } else if (currentItems.length > 0) {
    const ids = currentItems.map((i) => i.userId);
    const subs = await MatrimonySubscription.findAll({
      where: { userId: { [Op.in]: ids }, status: "ACTIVE" },
      attributes: ["userId", "plan"]
    }).catch(() => [] as MatrimonySubscription[]);
    const planByUser = new Map(subs.map((s) => [s.userId, s.plan]));
    for (const i of currentItems) {
      i.subscriptionPlan = planByUser.get(i.userId) ?? null;
    }
  }

  currentItems.sort((a, b) => {
    const aVal =
      sortBy === "updatedAt" ? new Date(a.updatedAt).getTime() : new Date(a.submittedAt).getTime();
    const bVal =
      sortBy === "updatedAt" ? new Date(b.updatedAt).getTime() : new Date(b.submittedAt).getTime();
    return sortDir === "ASC" ? aVal - bVal : bVal - aVal;
  });

  const total = currentItems.length;
  const offset = (page - 1) * limit;
  const pageItems = currentItems.slice(offset, offset + limit);

  await Promise.all(
    pageItems.map(async (item) => {
      const url = item._candidateUrl;
      item.profilePhotoUrl = url ? publicUserPhoto(url) : null;
      delete item._candidateUrl;
    })
  );

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
  const accountOwnerPhoto = publicUserPhoto(user.profilePhoto ?? null);
  const candidateRaw = resolveCandidatePhotoUrl(data as Record<string, unknown>);
  const matrimonyCandidatePhoto = candidateRaw ? publicUserPhoto(candidateRaw) : null;
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

  const approvedLifecycle =
    (approvedSigned as { matrimonyLifecycle?: string; matrimonyProfileActive?: boolean } | null)
      ?.matrimonyLifecycle ??
    ((approvedSigned as { matrimonyProfileActive?: boolean } | null)?.matrimonyProfileActive
      ? "ACTIVE"
      : null);

  const { revealPresence } = await import("./LastSeen.service");
  const presence = await revealPresence(null, user.id, { adminBypass: true });

  return {
    id: row.id,
    userId: user.id,
    workflowStatus,
    rowStatus: row.status,
    lifecycleStatus: approvedLifecycle,
    presence: {
      online: presence.online,
      lastSeenAt: presence.lastSeenAt,
      label: presence.label,
      lastSeenVisibility: user.lastSeenVisibility ?? "MATCHES_ONLY"
    },
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
    rejectionReasons: MATRIMONY_REJECTION_REASONS,
    ...(await buildApplicationHistoryPayload(row.userId, row.id))
  };
}

/** All matrimony application versions for a user + timeline (history preserved). */
async function buildApplicationHistoryPayload(userId: number, currentId: number) {
  const allRows = await PendingProfileUpdate.findAll({
    where: { userId, section: "MATRIMONY" },
    order: [["submittedAt", "ASC"]]
  });
  const metaMap = await loadMetaForPendingIds(allRows.map((r) => r.id));
  const allNotes = await MatrimonyAdminNote.findAll({
    where: { userId },
    order: [["createdAt", "ASC"]]
  }).catch(() => [] as MatrimonyAdminNote[]);
  const notesByPending = new Map<number, MatrimonyAdminNote[]>();
  for (const n of allNotes) {
    const list = notesByPending.get(n.pendingUpdateId) ?? [];
    list.push(n);
    notesByPending.set(n.pendingUpdateId, list);
  }

  const applicationHistory = allRows.map((r, idx) => {
    const raw = readRawPendingData(r.data);
    const meta = metaMap.get(r.id) ?? null;
    const workflowStatus = deriveWorkflow(r.status, raw, meta);
    const versionNotes = (notesByPending.get(r.id) ?? []).map((n) => ({
      id: n.id,
      noteType: n.noteType,
      content: n.content,
      createdBy: n.createdBy,
      createdAt: n.createdAt.toISOString()
    }));
    return {
      id: r.id,
      applicationVersion: idx + 1,
      isCurrent: r.id === currentId,
      workflowStatus,
      rowStatus: r.status,
      submittedAt: r.submittedAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      adminRemarks: r.adminRemarks,
      assignedReviewer: meta?.assignedReviewer ?? null,
      reviewedBy: meta?.reviewedBy ?? null,
      rejectionReason: meta?.rejectionReason ?? null,
      rejectionComment: meta?.rejectionComment ?? null,
      changeRequest:
        (raw[CHANGE_REQUEST_KEY] as MatrimonyRequestMeta["changeRequest"]) ??
        meta?.changeRequest ??
        null,
      resubmissionCount: Number(raw[RESUB_COUNT_KEY] ?? 0),
      submittedForReview: raw[SUBMITTED_FLAG] !== false,
      adminDecision: adminDecisionLabel(workflowStatus, meta?.reviewedBy ?? null),
      notes: versionNotes
    };
  });

  const currentVersion =
    applicationHistory.find((h) => h.isCurrent)?.applicationVersion ??
    applicationHistory.length;

  const timeline: Array<{
    at: string;
    type: string;
    label: string;
    actor: string | null;
    applicationVersion: number | null;
    meta?: string | null;
  }> = [];

  for (const h of applicationHistory) {
    timeline.push({
      at: h.submittedAt,
      type: "APPLICATION_SUBMITTED",
      label: `Version ${h.applicationVersion} submitted`,
      actor: "User",
      applicationVersion: h.applicationVersion
    });
    if (h.workflowStatus === "APPROVED" && h.reviewedAt) {
      timeline.push({
        at: h.reviewedAt,
        type: "APPROVED",
        label: `Version ${h.applicationVersion} approved`,
        actor: h.reviewedBy,
        applicationVersion: h.applicationVersion,
        meta: h.adminRemarks
      });
    }
    if (h.workflowStatus === "REJECTED" && h.reviewedAt) {
      timeline.push({
        at: h.reviewedAt,
        type: "REJECTED",
        label: `Version ${h.applicationVersion} rejected`,
        actor: h.reviewedBy,
        applicationVersion: h.applicationVersion,
        meta: h.rejectionComment || h.rejectionReason
      });
    }
    if (h.workflowStatus === "CHANGES_REQUESTED") {
      const at = h.changeRequest?.requestedAt || h.updatedAt;
      timeline.push({
        at,
        type: "CHANGES_REQUESTED",
        label: `Version ${h.applicationVersion} — changes requested`,
        actor: h.changeRequest?.requestedBy || h.reviewedBy,
        applicationVersion: h.applicationVersion,
        meta: h.changeRequest?.comment || h.rejectionComment
      });
    }
    if (h.resubmissionCount > 0) {
      timeline.push({
        at: h.updatedAt,
        type: "RESUBMITTED",
        label: `Version ${h.applicationVersion} resubmitted (×${h.resubmissionCount})`,
        actor: "User",
        applicationVersion: h.applicationVersion
      });
    }
  }

  const audits = await MatrimonyReviewAudit.findAll({
    where: { userId },
    order: [["createdAt", "ASC"]],
    limit: 100
  }).catch(() => [] as MatrimonyReviewAudit[]);

  for (const a of audits) {
    const version =
      applicationHistory.find((h) => h.id === a.pendingUpdateId)?.applicationVersion ?? null;
    timeline.push({
      at: a.createdAt.toISOString(),
      type: a.action,
      label: a.action.replace(/_/g, " "),
      actor: a.createdBy,
      applicationVersion: version,
      meta: a.payload ? JSON.stringify(a.payload) : null
    });
  }

  timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const currentRow = allRows.find((r) => r.id === currentId);
  const pendingSince = currentRow?.submittedAt
    ? Math.max(
        0,
        Math.floor((Date.now() - currentRow.submittedAt.getTime()) / (24 * 60 * 60 * 1000))
      )
    : null;

  return {
    applicationVersion: currentVersion,
    applicationCount: applicationHistory.length,
    isCurrent: true,
    pendingSinceDays: pendingSince,
    applicationHistory,
    timeline
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
  const data = normalizeJsonColumn(row.data, SECTION_ALLOWED_KEYS.matrimony) ?? {};
  const accountRow = await User.findByPk(row.userId, { attributes: ["profilePhoto"] });
  const { missing, percentage } = computeMatrimonyCompletion(
    null,
    data,
    accountRow?.profilePhoto ?? null
  );
  if (missing.length > 0) {
    throw Object.assign(
      new Error(
        `Cannot approve: profile is ${percentage}% complete. Missing: ${missing.slice(0, 8).join(", ")}${
          missing.length > 8 ? "…" : ""
        }`
      ),
      { status: 400 }
    );
  }
  if (resolveCandidatePhotoUrl(data)) {
    data.candidatePhotoStatus = "APPROVED";
    await row.update({ data: syncMatrimonyPhotoFields(data), updatedAt: new Date() } as any);
  }
  await approveProfileUpdate(updateId, adminEmail, remarks ?? null);
  // Ensure approved profiles start in ACTIVE lifecycle (discoverable).
  const profile = await ensureUserProfile(row.userId);
  const approvedMatrimony =
    normalizeJsonColumn(profile.matrimony, SECTION_ALLOWED_KEYS.matrimony) ?? {};
  await profile.update({
    matrimony: {
      ...approvedMatrimony,
      matrimonyProfileActive: true,
      matrimonyLifecycle: "ACTIVE",
      matrimonySuspended: false,
      pausedAt: null,
      closedAt: null,
      closeReason: null
    }
  } as any);
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
  const { notifyMatrimonyProfileApproved } = await import("./Notification.service");
  void notifyMatrimonyProfileApproved(row.userId).catch(() => {});
}

/** Approve / reject / request reupload for bride/groom photo only (pending request). */
export async function updateCandidatePhotoStatus(
  updateId: number,
  adminEmail: string,
  status: MatrimonyCandidatePhotoStatus,
  remarks?: string
) {
  const row = await PendingProfileUpdate.findByPk(updateId);
  if (!row || row.section !== "MATRIMONY") throw Object.assign(new Error("Request not found"), { status: 404 });
  if (row.status !== "PENDING") throw Object.assign(new Error("Update is not pending"), { status: 400 });

  const data = normalizeJsonColumn(row.data, SECTION_ALLOWED_KEYS.matrimony) ?? {};
  if (!resolveCandidatePhotoUrl(data)) {
    throw Object.assign(new Error("No candidate photo on this request"), { status: 400 });
  }

  data.candidatePhotoStatus = status;
  if (remarks?.trim()) data.candidatePhotoAdminRemarks = remarks.trim();
  const synced = syncMatrimonyPhotoFields(data);
  await row.update({ data: synced, updatedAt: new Date() } as any);

  if (status === "APPROVED") {
    let profile = await ensureUserProfile(row.userId);
    const approved = normalizeJsonColumn(profile.matrimony, SECTION_ALLOWED_KEYS.matrimony) ?? {};
    const merged = syncMatrimonyPhotoFields({
      ...approved,
      ...synced,
      candidatePhotoStatus: "APPROVED"
    });
    await profile.update({ matrimony: merged } as any);
  }

  await writeAudit(row.userId, row.id, "PHOTO_STATUS_UPDATED", adminEmail, { status, remarks }).catch(
    () => {}
  );
  return { candidatePhotoStatus: status };
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
  const { notifyMatrimonyProfileRejected } = await import("./Notification.service");
  void notifyMatrimonyProfileRejected(row.userId, remarks).catch(() => {});
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
  const { notifyMatrimonyChangesRequested } = await import("./Notification.service");
  void notifyMatrimonyChangesRequested(row.userId, comment).catch(() => {});
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

  let profile = await ensureUserProfile(row.userId);
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
