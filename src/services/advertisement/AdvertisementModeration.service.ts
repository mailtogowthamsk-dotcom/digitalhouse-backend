import { Transaction } from "sequelize";
import { sequelize } from "../../config/db";
import { User } from "../../models";
import {
  Advertisement,
  AdvertisementEntitlement,
  AdvertisementExtension,
  AdvertisementModerationLog
} from "../../models/Advertisement.models";
import { PaymentInvoice, PaymentOrder } from "../../models/Payment.models";
import { audit } from "../platform/shared";
import * as Invoice from "../payments/Invoice.service";
import * as Refund from "../payments/Refund.service";
import { isDuplicateCapture } from "../payments/Payment.service";
import * as Notifications from "../Notification.service";
import {
  assertTransition,
  publishStatusAfterApproval
} from "./AdvertisementState.service";
import { assertPublishableCreative } from "./advertisementCreative";
import * as Ads from "./Advertisement.service";
import * as Analytics from "./AdvertisementAnalytics.service";
import { roundCtrPercent } from "../../constants/advertisement.constants";

function httpError(message: string, status: number, code?: string) {
  return Object.assign(new Error(message), { status, code });
}

async function writeLog(
  advertisementId: number,
  actor: string,
  action: string,
  fromStatus: string | null,
  toStatus: string | null,
  reason: string | null,
  transaction?: Transaction
) {
  await AdvertisementModerationLog.create(
    {
      advertisementId,
      actor,
      action,
      fromStatus,
      toStatus,
      reason,
      createdAt: new Date()
    },
    { transaction }
  );
}

export async function approveAdvertisement(id: number, adminEmail: string) {
  const result = await sequelize.transaction(async (transaction) => {
    const ad = await Advertisement.findByPk(id, { transaction, lock: Transaction.LOCK.UPDATE });
    if (!ad) throw httpError("Advertisement not found", 404, "NOT_FOUND");
    if (ad.status === "APPROVED" || ad.status === "SCHEDULED" || ad.status === "ACTIVE") {
      return { ad, already: true };
    }
    assertTransition(ad.status, "APPROVED");
    assertPublishableCreative(ad);
    const now = new Date();
    const resubmission = Boolean(ad.approvedAt && ad.scheduledEndAt);
    let publish: "ACTIVE" | "SCHEDULED" | "EXPIRED";
    if (resubmission) {
      if (now >= ad.scheduledEndAt!) {
        assertTransition("APPROVED", "EXPIRED");
        publish = "EXPIRED";
        ad.expiredAt = now;
      } else {
        publish = publishStatusAfterApproval(ad.scheduledStartAt, now);
        assertTransition("APPROVED", publish);
        if (publish === "ACTIVE" && !ad.actualStartAt) ad.actualStartAt = now;
      }
      ad.status = publish;
      ad.rejectionReason = null;
      ad.updatedAt = now;
      await ad.save({ transaction });
      await writeLog(ad.id, adminEmail, "APPROVE", "PENDING_REVIEW", publish, "resubmission", transaction);
      return { ad, already: false, resubmission: true };
    }

    const start = ad.scheduledStartAt && ad.scheduledStartAt > now ? ad.scheduledStartAt : now;
    const durationDays = ad.pricingSnapshot?.durationDays ?? ad.durationDays ?? 0;
    const end = new Date(start.getTime() + durationDays * 24 * 60 * 60 * 1000);
    const firstPublish = publishStatusAfterApproval(start, now);

    assertTransition("APPROVED", firstPublish);
    ad.status = firstPublish;
    ad.approvedAt = now;
    ad.scheduledStartAt = start;
    ad.scheduledEndAt = end;
    if (firstPublish === "ACTIVE") ad.actualStartAt = now;
    ad.updatedAt = now;
    await ad.save({ transaction });

    const entitlement = await AdvertisementEntitlement.findOne({
      where: { advertisementId: ad.id },
      transaction
    });
    if (entitlement) {
      await entitlement.update(
        {
          status: "ACTIVE",
          startsAt: start,
          endsAt: end,
          updatedAt: now
        },
        { transaction }
      );
    }

    await writeLog(ad.id, adminEmail, "APPROVE", "PENDING_REVIEW", firstPublish, null, transaction);
    return { ad, already: false };
  });

  await audit(adminEmail, "ADVERTISEMENT_APPROVED", "advertisements", { id: result.ad.id });
  if (!result.already && result.ad.status !== "EXPIRED") {
    void Notifications.notifyAdvertisementApproved(result.ad.userId, result.ad.id, result.ad.title).catch(
      () => {}
    );
    if (result.ad.status === "ACTIVE") {
      void Notifications.notifyAdvertisementActivated(result.ad.userId, result.ad.id, result.ad.title).catch(
        () => {}
      );
    }
  }
  console.log("[advertisement] approved", { id: result.ad.id, status: result.ad.status, adminEmail });
  return result.ad;
}

export async function rejectAdvertisement(id: number, adminEmail: string, reason: string) {
  const trimmed = String(reason || "").trim();
  if (trimmed.length < 3 || trimmed.length > 500) {
    throw httpError("Rejection reason is required (3–500 characters)", 400, "REASON_REQUIRED");
  }
  const result = await sequelize.transaction(async (transaction) => {
    const ad = await Advertisement.findByPk(id, { transaction, lock: Transaction.LOCK.UPDATE });
    if (!ad) throw httpError("Advertisement not found", 404, "NOT_FOUND");
    if (ad.status === "REJECTED") return { ad, already: true };
    assertTransition(ad.status, "REJECTED");
    const from = ad.status;
    const now = new Date();
    ad.status = "REJECTED";
    ad.rejectedAt = now;
    ad.rejectionReason = trimmed;
    ad.updatedAt = now;
    await ad.save({ transaction });
    await writeLog(ad.id, adminEmail, "REJECT", from, "REJECTED", trimmed, transaction);
    return { ad, already: false };
  });
  await audit(adminEmail, "ADVERTISEMENT_REJECTED", "advertisements", {
    id: result.ad.id,
    reason: trimmed
  });
  if (!result.already) {
    void Notifications.notifyAdvertisementRejected(
      result.ad.userId,
      result.ad.id,
      result.ad.title,
      trimmed
    ).catch(() => {});
  }
  console.log("[advertisement] rejected", { id: result.ad.id, adminEmail });
  return result.ad;
}

export async function pauseAdvertisement(id: number, adminEmail: string, reason?: string) {
  const ad = await sequelize.transaction(async (transaction) => {
    const row = await Advertisement.findByPk(id, { transaction, lock: Transaction.LOCK.UPDATE });
    if (!row) throw httpError("Advertisement not found", 404, "NOT_FOUND");
    if (row.status === "PAUSED") return row;
    assertTransition(row.status, "PAUSED");
    const from = row.status;
    row.status = "PAUSED";
    row.pausedAt = new Date();
    row.updatedAt = new Date();
    await row.save({ transaction });
    await writeLog(row.id, adminEmail, "PAUSE", from, "PAUSED", reason ?? null, transaction);
    return row;
  });
  await audit(adminEmail, "ADVERTISEMENT_PAUSED", "advertisements", { id: ad.id });
  void Notifications.notifyAdvertisementPaused(ad.userId, ad.id, ad.title).catch(() => {});
  console.log("[advertisement] paused", { id: ad.id, adminEmail });
  return ad;
}

export async function resumeAdvertisement(id: number, adminEmail: string) {
  const ad = await sequelize.transaction(async (transaction) => {
    const row = await Advertisement.findByPk(id, { transaction, lock: Transaction.LOCK.UPDATE });
    if (!row) throw httpError("Advertisement not found", 404, "NOT_FOUND");
    if (row.status === "ACTIVE") return row;
    assertTransition(row.status, "ACTIVE");
    const now = new Date();
    if (row.scheduledEndAt && row.scheduledEndAt <= now) {
      throw httpError("Campaign end date has passed; resume is not allowed", 400, "ALREADY_ENDED");
    }
    const from = row.status;
    row.status = "ACTIVE";
    row.pausedAt = null;
    if (!row.actualStartAt) row.actualStartAt = now;
    row.updatedAt = now;
    await row.save({ transaction });
    await writeLog(row.id, adminEmail, "RESUME", from, "ACTIVE", null, transaction);
    return row;
  });
  await audit(adminEmail, "ADVERTISEMENT_RESUMED", "advertisements", { id: ad.id });
  void Notifications.notifyAdvertisementResumed(ad.userId, ad.id, ad.title).catch(() => {});
  console.log("[advertisement] resumed", { id: ad.id, adminEmail });
  return ad;
}

export async function cancelAdvertisement(id: number, adminEmail: string, reason?: string) {
  const ad = await sequelize.transaction(async (transaction) => {
    const row = await Advertisement.findByPk(id, { transaction, lock: Transaction.LOCK.UPDATE });
    if (!row) throw httpError("Advertisement not found", 404, "NOT_FOUND");
    if (row.status === "CANCELLED") return row;
    assertTransition(row.status, "CANCELLED");
    const from = row.status;
    row.status = "CANCELLED";
    row.updatedAt = new Date();
    await row.save({ transaction });
    const entitlement = await AdvertisementEntitlement.findOne({
      where: { advertisementId: row.id },
      transaction
    });
    if (entitlement && entitlement.status !== "REFUNDED") {
      await entitlement.update({ status: "CANCELLED", updatedAt: new Date() }, { transaction });
    }
    await writeLog(row.id, adminEmail, "CANCEL", from, "CANCELLED", reason ?? null, transaction);
    return row;
  });
  await audit(adminEmail, "ADVERTISEMENT_CANCELLED", "advertisements", { id: ad.id });
  return ad;
}

export async function extendAdvertisement(
  id: number,
  extensionDays: number,
  adminEmail: string,
  reason: string
) {
  if (!Number.isInteger(extensionDays) || extensionDays < 1 || extensionDays > 365) {
    throw httpError("Extension must be 1–365 days", 400, "INVALID_DURATION");
  }
  const ad = await sequelize.transaction(async (transaction) => {
    const row = await Advertisement.findByPk(id, { transaction, lock: Transaction.LOCK.UPDATE });
    if (!row) throw httpError("Advertisement not found", 404, "NOT_FOUND");
    if (row.status !== "ACTIVE" && row.status !== "PAUSED" && row.status !== "SCHEDULED") {
      throw httpError("Only scheduled, active, or paused campaigns can be extended", 400);
    }
    const oldEnd = row.scheduledEndAt ?? new Date();
    const newEnd = new Date(oldEnd.getTime() + extensionDays * 24 * 60 * 60 * 1000);
    row.scheduledEndAt = newEnd;
    row.updatedAt = new Date();
    await row.save({ transaction });
    await AdvertisementExtension.create(
      {
        advertisementId: row.id,
        oldEndAt: oldEnd,
        newEndAt: newEnd,
        extensionDays,
        adminEmail,
        reason: reason?.slice(0, 500) || null,
        createdAt: new Date()
      },
      { transaction }
    );
    const entitlement = await AdvertisementEntitlement.findOne({
      where: { advertisementId: row.id },
      transaction
    });
    if (entitlement) {
      await entitlement.update({ endsAt: newEnd, updatedAt: new Date() }, { transaction });
    }
    await writeLog(
      row.id,
      adminEmail,
      "EXTEND",
      row.status,
      row.status,
      `+${extensionDays} days`,
      transaction
    );
    return row;
  });
  await audit(adminEmail, "ADVERTISEMENT_EXTENDED", "advertisements", {
    id: ad.id,
    extensionDays,
    reason
  });
  return ad;
}

export async function refundAdvertisementPayment(
  id: number,
  adminEmail: string,
  reason: string,
  paymentOrderId?: number
) {
  const ad = await Advertisement.findByPk(id);
  if (!ad) throw httpError("Advertisement not found", 404, "NOT_FOUND");
  const targetOrderId = paymentOrderId ?? ad.paymentOrderId;
  if (!targetOrderId) throw httpError("No payment to refund", 400, "NO_PAYMENT");

  const order = await PaymentOrder.findByPk(targetOrderId);
  if (!order || order.module !== "advertisement" || order.referenceId !== ad.id) {
    throw httpError("Payment order does not belong to this advertisement", 404, "NO_PAYMENT");
  }

  const refundOnReject = Boolean(ad.pricingSnapshot?.refundOnReject);
  if (ad.status === "REJECTED" && !refundOnReject && !isDuplicateCapture(order)) {
    throw httpError(
      "This campaign is not eligible for automatic rejection refund. Refund policy is disabled on the purchased pricing.",
      400,
      "REFUND_NOT_ELIGIBLE"
    );
  }
  const result = await Refund.recordRefund({
    paymentOrderId: order.id,
    reason,
    adminEmail
  });
  await writeLog(ad.id, adminEmail, "REFUND", ad.status, ad.status, reason);
  await audit(adminEmail, "ADVERTISEMENT_REFUND", "advertisements", {
    id: ad.id,
    paymentOrderId: order.id,
    duplicateCapture: isDuplicateCapture(order)
  });
  return result;
}

export async function listAdmin(query: {
  page: number;
  limit: number;
  status?: string;
  q?: string;
}) {
  const { Op } = await import("sequelize");
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 25));
  const where: Record<string, unknown> = {};
  if (query.status && query.status !== "all") where.status = query.status;
  if (query.q?.trim()) {
    const q = `%${query.q.trim()}%`;
    where[Op.or as unknown as string] = [
      { title: { [Op.like]: q } },
      { "$User.email$": { [Op.like]: q } },
      { "$User.fullName$": { [Op.like]: q } }
    ];
  }
  const { rows, count } = await Advertisement.findAndCountAll({
    where,
    include: [
      { model: User, attributes: ["id", "fullName", "email"], required: false },
      { model: PaymentOrder, attributes: ["id", "status"], required: false }
    ],
    order: [["id", "DESC"]],
    offset: (page - 1) * limit,
    limit,
    distinct: true
  });
  return {
    items: rows.map((ad) => {
      const user = (ad as Advertisement & { User?: { id: number; fullName: string; email: string } }).User;
      const payment = (ad as Advertisement & { PaymentOrder?: { id: number; status: string } }).PaymentOrder;
      return {
        id: ad.id,
        advertiser: user ? { id: user.id, name: user.fullName, email: user.email } : { id: ad.userId },
        title: ad.title,
        businessName: ad.businessName || ad.title,
        businessCategory: ad.businessCategory,
        typeCode: ad.typeCode,
        amountPaise: ad.pricingSnapshot?.pricePaise ?? null,
        paymentOrderId: ad.paymentOrderId,
        paymentStatus: payment?.status ?? null,
        status: ad.status,
        scheduledStartAt: ad.scheduledStartAt,
        scheduledEndAt: ad.scheduledEndAt,
        impressions: ad.impressionsCount,
        clicks: ad.clicksCount,
        reports: ad.reportsCount ?? 0,
        ctr: roundCtrPercent(ad.clicksCount, ad.impressionsCount),
        createdAt: ad.createdAt
      };
    }),
    page,
    limit,
    total: count
  };
}

export async function getAdminDetail(id: number) {
  const ad = await Advertisement.findByPk(id, {
    include: [{ model: User, attributes: ["id", "fullName", "email", "mobile"], required: false }]
  });
  if (!ad) throw httpError("Advertisement not found", 404, "NOT_FOUND");
  const user = (ad as Advertisement & { User?: User }).User;
  const payments = await PaymentOrder.findAll({
    where: { module: "advertisement", referenceId: ad.id },
    order: [["id", "ASC"]]
  });
  const payment = ad.paymentOrderId
    ? payments.find((row) => row.id === ad.paymentOrderId) ?? (await PaymentOrder.findByPk(ad.paymentOrderId))
    : null;
  const invoice = payment ? await Invoice.getInvoiceByPaymentOrderId(payment.id) : null;
  const logs = await AdvertisementModerationLog.findAll({
    where: { advertisementId: ad.id },
    order: [["id", "ASC"]]
  });
  const entitlement = await AdvertisementEntitlement.findOne({ where: { advertisementId: ad.id } });
  return {
    advertisement: {
      ...Ads.serializeAdvertiser(ad),
      refundEligibleOnReject: Boolean(ad.pricingSnapshot?.refundOnReject)
    },
    advertiser: user
      ? { id: user.id, name: user.fullName, email: user.email, mobile: user.mobile }
      : { id: ad.userId },
    payment: payment
      ? {
          id: payment.id,
          status: payment.status,
          amountPaise: payment.amountPaise,
          razorpayOrderId: payment.razorpayOrderId,
          razorpayPaymentId: payment.razorpayPaymentId,
          currency: payment.currency,
          createdAt: payment.createdAt,
          duplicateCapture: isDuplicateCapture(payment)
        }
      : null,
    payments: payments.map((row) => ({
      id: row.id,
      status: row.status,
      amountPaise: row.amountPaise,
      razorpayOrderId: row.razorpayOrderId,
      razorpayPaymentId: row.razorpayPaymentId,
      currency: row.currency,
      createdAt: row.createdAt,
      duplicateCapture: isDuplicateCapture(row),
      primaryOrderId: typeof row.meta?.primaryOrderId === "number" ? row.meta.primaryOrderId : null
    })),
    invoice: invoice ? Invoice.serializeInvoice(invoice) : null,
    entitlement: entitlement
      ? {
          status: entitlement.status,
          durationDays: entitlement.durationDays,
          amountPaise: entitlement.amountPaise,
          startsAt: entitlement.startsAt,
          endsAt: entitlement.endsAt
        }
      : null,
    moderation: logs.map((l) => ({
      action: l.action,
      fromStatus: l.fromStatus,
      toStatus: l.toStatus,
      actor: l.actor,
      reason: l.reason,
      createdAt: l.createdAt
    })),
    clickActions: await Analytics.getClickActionCounts(ad.id)
  };
}

export async function createComplimentaryAdvertisement(
  input: Ads.CreateAdvertisementInput & { userId: number; scheduledStartAt?: Date | null; scheduledEndAt?: Date | null },
  adminEmail: string
) {
  const owner = await User.findByPk(input.userId);
  if (!owner) throw httpError("Advertiser user not found", 404, "USER_NOT_FOUND");
  const advertisement = await Ads.createDraft(input.userId, input, { billingMode: "complimentary" });
  if (input.scheduledStartAt || input.scheduledEndAt) {
    const row = await Advertisement.findByPk(advertisement.id);
    if (row) {
      if (input.scheduledStartAt) row.scheduledStartAt = input.scheduledStartAt;
      if (input.scheduledEndAt) row.scheduledEndAt = input.scheduledEndAt;
      row.updatedAt = new Date();
      await row.save();
    }
  }
  await writeLog(advertisement.id, adminEmail, "ADMIN_CREATE", null, "DRAFT", "complimentary");
  await audit(adminEmail, "ADVERTISEMENT_ADMIN_CREATED", "advertisements", { id: advertisement.id });
  return Ads.getDetailForAdvertiser(input.userId, advertisement.id);
}

export async function publishComplimentaryAdvertisement(
  id: number,
  adminEmail: string,
  schedule?: { scheduledStartAt?: Date | null; scheduledEndAt?: Date | null }
) {
  const result = await sequelize.transaction(async (transaction) => {
    const ad = await Advertisement.findByPk(id, { transaction, lock: Transaction.LOCK.UPDATE });
    if (!ad) throw httpError("Advertisement not found", 404, "NOT_FOUND");
    if (ad.billingMode !== "complimentary") {
      throw httpError("Only complimentary advertisements can be published without payment", 400, "NOT_COMPLIMENTARY");
    }
    if (ad.status === "ACTIVE" || ad.status === "SCHEDULED") {
      return { ad, already: true };
    }
    assertPublishableCreative(ad);
    const now = new Date();
    const start =
      schedule?.scheduledStartAt && schedule.scheduledStartAt.getTime() > now.getTime()
        ? schedule.scheduledStartAt
        : ad.scheduledStartAt && ad.scheduledStartAt.getTime() > now.getTime()
          ? ad.scheduledStartAt
          : now;
    const end =
      schedule?.scheduledEndAt && schedule.scheduledEndAt.getTime() > start.getTime()
        ? schedule.scheduledEndAt
        : ad.scheduledEndAt && ad.scheduledEndAt.getTime() > start.getTime()
          ? ad.scheduledEndAt
          : new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    const publish = publishStatusAfterApproval(start, now);
    assertTransition(ad.status, publish, { billingMode: "complimentary" });
    const from = ad.status;
    ad.status = publish;
    ad.approvedAt = now;
    ad.scheduledStartAt = start;
    ad.scheduledEndAt = end;
    ad.durationDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
    if (publish === "ACTIVE") ad.actualStartAt = now;
    ad.updatedAt = now;
    await ad.save({ transaction });
    await writeLog(ad.id, adminEmail, "ADMIN_PUBLISH", from, publish, null, transaction);
    return { ad, already: false };
  });
  await audit(adminEmail, "ADVERTISEMENT_ADMIN_PUBLISHED", "advertisements", { id: result.ad.id });
  return result.ad;
}

export async function deleteAdminDraft(id: number, adminEmail: string) {
  const ad = await Advertisement.findByPk(id);
  if (!ad) throw httpError("Advertisement not found", 404, "NOT_FOUND");
  await Ads.deleteDraft(ad.userId, id);
  await audit(adminEmail, "ADVERTISEMENT_ADMIN_DELETED", "advertisements", { id });
  return { deleted: true as const };
}
