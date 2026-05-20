import { Op } from "sequelize";
import {
  User,
  UserProfile,
  MatrimonySavedProfile,
  MatrimonyBlock,
  MatrimonyReport
} from "../models";
import { normalizeJsonColumn, SECTION_ALLOWED_KEYS } from "./Profile.service";
import type { MatrimonySection } from "../models/UserProfile.model";
import { resolveCandidatePhotoUrl } from "../constants/matrimony-photo.constants";
import {
  resolveMatrimonyCandidate,
  type MatrimonyCandidatePublic
} from "../utils/matrimonyCandidate.util";
import { toSignedUrlIfR2 } from "../utils/r2Client";
import { MATRIMONY_REPORT_REASONS } from "../constants/matrimony-safety.constants";

let tablesAvailable: boolean | null = null;

async function ensureTables(): Promise<boolean> {
  if (tablesAvailable !== null) return tablesAvailable;
  try {
    await MatrimonyBlock.findOne({ limit: 1 });
    tablesAvailable = true;
  } catch {
    tablesAvailable = false;
  }
  return tablesAvailable;
}

/** User ids hidden from viewer (either direction block). */
export async function getBlockedUserIds(viewerId: number): Promise<Set<number>> {
  if (!(await ensureTables())) return new Set();
  const rows = await MatrimonyBlock.findAll({
    where: {
      [Op.or]: [{ userId: viewerId }, { blockedUserId: viewerId }]
    },
    attributes: ["userId", "blockedUserId"]
  });
  const set = new Set<number>();
  for (const r of rows) {
    if (r.userId === viewerId) set.add(r.blockedUserId);
    else set.add(r.userId);
  }
  return set;
}

export async function assertNotBlocked(userId: number, otherUserId: number): Promise<void> {
  const blocked = await getBlockedUserIds(userId);
  if (blocked.has(otherUserId)) {
    const err = new Error("This profile is not available.");
    (err as any).status = 403;
    (err as any).code = "MATRIMONY_BLOCKED";
    throw err;
  }
}

export async function getCandidateSafetyFlags(
  viewerId: number,
  candidateUserId: number
): Promise<{ saved: boolean; blocked: boolean }> {
  if (!(await ensureTables())) return { saved: false, blocked: false };
  const [saved, blockedRow] = await Promise.all([
    MatrimonySavedProfile.findOne({ where: { userId: viewerId, savedUserId: candidateUserId } }),
    MatrimonyBlock.findOne({ where: { userId: viewerId, blockedUserId: candidateUserId } })
  ]);
  return { saved: !!saved, blocked: !!blockedRow };
}

export async function saveProfile(viewerId: number, candidateUserId: number): Promise<{ saved: true }> {
  if (viewerId === candidateUserId) {
    throw Object.assign(new Error("Invalid profile"), { status: 400 });
  }
  await assertNotBlocked(viewerId, candidateUserId);
  await MatrimonySavedProfile.findOrCreate({
    where: { userId: viewerId, savedUserId: candidateUserId },
    defaults: { userId: viewerId, savedUserId: candidateUserId, createdAt: new Date() } as any
  });
  return { saved: true };
}

export async function unsaveProfile(viewerId: number, candidateUserId: number): Promise<void> {
  await MatrimonySavedProfile.destroy({
    where: { userId: viewerId, savedUserId: candidateUserId }
  });
}

export async function listSavedProfiles(viewerId: number): Promise<
  Array<{
    userId: number;
    name: string;
    age: number | null;
    district: string | null;
    photoUrl: string | null;
    savedAt: string;
  }>
> {
  if (!(await ensureTables())) return [];
  const rows = await MatrimonySavedProfile.findAll({
    where: { userId: viewerId },
    order: [["createdAt", "DESC"]],
    limit: 100
  });
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.savedUserId);
  const users = await User.findAll({ where: { id: { [Op.in]: ids }, status: "APPROVED" } });
  const profiles = await UserProfile.findAll({ where: { userId: { [Op.in]: ids } } });
  const userById = new Map(users.map((u) => [u.id, u]));
  const profileByUser = new Map(profiles.map((p) => [p.userId, p]));

  const out: Array<{
    userId: number;
    name: string;
    age: number | null;
    district: string | null;
    photoUrl: string | null;
    savedAt: string;
  }> = [];

  for (const row of rows) {
    const u = userById.get(row.savedUserId);
    const p = profileByUser.get(row.savedUserId);
    if (!u || !p) continue;
    const m = normalizeJsonColumn(p.matrimony, SECTION_ALLOWED_KEYS.matrimony) as MatrimonySection | null;
    if (!m || m.matrimonyProfileActive !== true) continue;
    const candidate = resolveMatrimonyCandidate(u, m);
    const photoRaw = resolveCandidatePhotoUrl(m as Record<string, unknown>);
    const photoUrl = photoRaw ? (await toSignedUrlIfR2(photoRaw)) ?? photoRaw : null;
    out.push({
      userId: row.savedUserId,
      name: candidate.name,
      age: candidate.age,
      district: candidate.district,
      photoUrl,
      savedAt: row.createdAt.toISOString()
    });
  }
  return out;
}

export async function blockUser(viewerId: number, candidateUserId: number): Promise<{ blocked: true }> {
  if (viewerId === candidateUserId) {
    throw Object.assign(new Error("Invalid profile"), { status: 400 });
  }
  await MatrimonyBlock.findOrCreate({
    where: { userId: viewerId, blockedUserId: candidateUserId },
    defaults: { userId: viewerId, blockedUserId: candidateUserId, createdAt: new Date() } as any
  });
  await MatrimonySavedProfile.destroy({
    where: { userId: viewerId, savedUserId: candidateUserId }
  });
  return { blocked: true };
}

export async function unblockUser(viewerId: number, candidateUserId: number): Promise<void> {
  await MatrimonyBlock.destroy({
    where: { userId: viewerId, blockedUserId: candidateUserId }
  });
}

export async function reportProfile(
  reporterId: number,
  reportedUserId: number,
  reasonCode: string,
  details?: string
): Promise<{ id: number; status: string }> {
  if (reporterId === reportedUserId) {
    throw Object.assign(new Error("Invalid profile"), { status: 400 });
  }
  const label =
    MATRIMONY_REPORT_REASONS.find((r) => r.code === reasonCode)?.label ?? reasonCode;
  const reason = label.slice(0, 80);
  const detailText = details?.trim() || null;

  const existing = await MatrimonyReport.findOne({
    where: { reporterId, reportedUserId }
  });
  if (existing?.status === "PENDING") {
    const err = new Error("You already reported this profile. Our team will review it.");
    (err as any).status = 409;
    throw err;
  }

  if (existing) {
    await existing.update({
      reason,
      details: detailText,
      status: "PENDING",
      adminRemarks: null,
      reviewedBy: null,
      reviewedAt: null,
      updatedAt: new Date()
    } as any);
    return { id: existing.id, status: "PENDING" };
  }

  const row = await MatrimonyReport.create({
    reporterId,
    reportedUserId,
    reason,
    details: detailText,
    status: "PENDING"
  } as any);
  return { id: row.id, status: row.status };
}

export async function listReportsForAdmin(query: {
  page?: number;
  limit?: number;
  status?: string;
}) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 20));
  const offset = (page - 1) * limit;
  const where: Record<string, unknown> = {};
  if (query.status && query.status !== "any") where.status = query.status;

  const { count, rows } = await MatrimonyReport.findAndCountAll({
    where,
    order: [["createdAt", "DESC"]],
    limit,
    offset
  });

  const reporterIds = [...new Set(rows.map((r) => r.reporterId))];
  const reportedIds = [...new Set(rows.map((r) => r.reportedUserId))];
  const users = await User.findAll({
    where: { id: { [Op.in]: [...reporterIds, ...reportedIds] } },
    attributes: ["id", "fullName", "email"]
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  return {
    items: rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      details: r.details,
      status: r.status,
      adminRemarks: r.adminRemarks,
      reviewedBy: r.reviewedBy,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      reporter: {
        id: r.reporterId,
        name: userById.get(r.reporterId)?.fullName ?? "Unknown",
        email: userById.get(r.reporterId)?.email ?? null
      },
      reportedUser: {
        id: r.reportedUserId,
        name: userById.get(r.reportedUserId)?.fullName ?? "Unknown",
        email: userById.get(r.reportedUserId)?.email ?? null
      }
    })),
    total: count,
    page,
    limit
  };
}

export async function resolveReport(
  reportId: number,
  adminEmail: string,
  status: "RESOLVED" | "DISMISSED",
  adminRemarks?: string
) {
  const row = await MatrimonyReport.findByPk(reportId);
  if (!row) throw Object.assign(new Error("Report not found"), { status: 404 });
  await row.update({
    status,
    adminRemarks: adminRemarks?.trim() || null,
    reviewedBy: adminEmail,
    reviewedAt: new Date()
  } as any);
  return row;
}
