import { Op, UniqueConstraintError } from "sequelize";
import {
  ADVERTISEMENT_REPORT_REASON_LABELS,
  isAdvertisementReportReason,
  type AdvertisementReportReason
} from "../../constants/advertisement.constants";
import { Advertisement, AdvertisementReport } from "../../models/Advertisement.models";
import { User } from "../../models/user.model";
import { pauseAdvertisement, rejectAdvertisement, cancelAdvertisement } from "./AdvertisementModeration.service";

function httpError(message: string, status: number, code?: string) {
  return Object.assign(new Error(message), { status, code });
}

export function reportReasonCatalog() {
  return Object.entries(ADVERTISEMENT_REPORT_REASON_LABELS).map(([code, label]) => ({ code, label }));
}

export async function reportAdvertisement(params: {
  advertisementId: number;
  reporterUserId: number;
  reason: string;
  details?: string | null;
}): Promise<{ reported: boolean; duplicate: boolean }> {
  if (!isAdvertisementReportReason(params.reason)) {
    throw httpError("Unsupported report reason", 400, "INVALID_REASON");
  }
  const ad = await Advertisement.findByPk(params.advertisementId, { attributes: ["id", "userId", "status"] });
  if (!ad) throw httpError("Advertisement not found", 404, "NOT_FOUND");
  if (ad.userId === params.reporterUserId) {
    throw httpError("You cannot report your own advertisement", 400, "OWN_ADVERTISEMENT");
  }

  const now = new Date();
  try {
    await AdvertisementReport.create({
      advertisementId: ad.id,
      reporterUserId: params.reporterUserId,
      reason: params.reason,
      details: params.details?.trim().slice(0, 500) || null,
      status: "PENDING",
      reviewedAt: null,
      reviewedBy: null,
      reviewNotes: null,
      createdAt: now,
      updatedAt: now
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      return { reported: false, duplicate: true };
    }
    throw err;
  }

  await ad.increment("reportsCount");
  return { reported: true, duplicate: false };
}

export async function listAdminReports(query: {
  page: number;
  limit: number;
  status?: string;
  advertisementId?: number;
}) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 25));
  const where: Record<string, unknown> = {};
  if (query.status && query.status !== "all") where.status = query.status;
  if (query.advertisementId) where.advertisementId = query.advertisementId;

  const { rows, count } = await AdvertisementReport.findAndCountAll({
    where,
    include: [
      {
        model: Advertisement,
        attributes: ["id", "title", "status", "userId", "reportsCount"],
        required: false,
        include: [{ model: User, attributes: ["id", "fullName", "email"], required: false }]
      }
    ],
    order: [["id", "DESC"]],
    offset: (page - 1) * limit,
    limit
  });

  const reporterIds = [...new Set(rows.map((r) => r.reporterUserId))];
  const reporters = reporterIds.length
    ? await User.findAll({
        where: { id: { [Op.in]: reporterIds } },
        attributes: ["id", "fullName", "email"]
      })
    : [];
  const reporterById = new Map(reporters.map((u) => [u.id, u]));

  return {
    items: rows.map((row) => {
      const ad = (row as AdvertisementReport & { Advertisement?: Advertisement & { User?: User } }).Advertisement;
      const advertiser = ad?.User;
      const reporter = reporterById.get(row.reporterUserId);
      return {
        id: row.id,
        advertisementId: row.advertisementId,
        advertisementTitle: ad?.title ?? null,
        advertisementStatus: ad?.status ?? null,
        advertiser: advertiser
          ? { id: advertiser.id, name: advertiser.fullName, email: advertiser.email }
          : ad
            ? { id: ad.userId }
            : null,
        reporter: reporter
          ? { id: reporter.id, name: reporter.fullName, email: reporter.email }
          : { id: row.reporterUserId },
        reason: row.reason,
        reasonLabel: ADVERTISEMENT_REPORT_REASON_LABELS[row.reason as AdvertisementReportReason] || row.reason,
        details: row.details,
        status: row.status,
        createdAt: row.createdAt,
        reviewedAt: row.reviewedAt,
        reviewedBy: row.reviewedBy,
        reviewNotes: row.reviewNotes
      };
    }),
    page,
    limit,
    total: count
  };
}

export async function reviewAdvertisementReport(params: {
  reportId: number;
  adminEmail: string;
  status: "UNDER_REVIEW" | "RESOLVED" | "DISMISSED";
  notes?: string | null;
  advertisementAction?: "keep" | "pause" | "reject" | "cancel" | null;
  rejectReason?: string | null;
}) {
  const row = await AdvertisementReport.findByPk(params.reportId);
  if (!row) throw httpError("Report not found", 404, "NOT_FOUND");

  if (params.advertisementAction === "pause") {
    await pauseAdvertisement(row.advertisementId, params.adminEmail, params.notes || "Report review");
  } else if (params.advertisementAction === "reject") {
    await rejectAdvertisement(
      row.advertisementId,
      params.adminEmail,
      params.rejectReason?.trim() || params.notes?.trim() || "Removed after user reports"
    );
  } else if (params.advertisementAction === "cancel") {
    await cancelAdvertisement(row.advertisementId, params.adminEmail, params.notes || "Removed after user reports");
  }

  row.status = params.status;
  row.reviewedAt = new Date();
  row.reviewedBy = params.adminEmail;
  row.reviewNotes = params.notes?.trim().slice(0, 500) || null;
  row.updatedAt = new Date();
  await row.save();
  return row;
}

export async function listReportsForAdvertisement(advertisementId: number) {
  const rows = await AdvertisementReport.findAll({
    where: { advertisementId },
    order: [["id", "DESC"]],
    limit: 50
  });
  return rows.map((row) => ({
    id: row.id,
    reporterUserId: row.reporterUserId,
    reason: row.reason,
    reasonLabel: ADVERTISEMENT_REPORT_REASON_LABELS[row.reason as AdvertisementReportReason] || row.reason,
    details: row.details,
    status: row.status,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
    reviewedBy: row.reviewedBy,
    reviewNotes: row.reviewNotes
  }));
}
