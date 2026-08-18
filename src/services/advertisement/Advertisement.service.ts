import { Transaction } from "sequelize";
import { sequelize } from "../../config/db";
import {
  CTA_MAX,
  CTA_MIN,
  DEFAULT_TARGETING,
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  TITLE_MAX,
  TITLE_MIN,
  UNTITLED_DRAFT_TITLE,
  invoiceAvailableForStatus,
  mediaFileMatchesTypeKind,
  mergePurchasedPricingSnapshot,
  remainingDays,
  roundCtrPercent,
  type AdvertisementPlacement
} from "../../constants/advertisement.constants";
import { MediaFile } from "../../models";
import {
  Advertisement,
  AdvertisementDailyStat,
  AdvertisementEntitlement,
  AdvertisementEvent,
  AdvertisementExtension,
  AdvertisementModerationLog,
  AdvertisementReport,
  AdvertisementType,
  AdvertisementUniqueReach,
  AdvertisementUserExposure,
  type AdvertisementPricingSnapshot
} from "../../models/Advertisement.models";
import { PaymentInvoice, PaymentOrder } from "../../models/Payment.models";
import { assertSafeHttpUrl } from "../../utils/safeUrl";
import { deleteMediaArtifacts, toPublicUrlIfR2 } from "../../utils/r2Client";
import { mediaService } from "../Media.service";
import * as Notifications from "../Notification.service";
import * as Payment from "../payments/Payment.service";
import * as Invoice from "../payments/Invoice.service";
import { getCentralGstPercent, splitGstInclusive } from "../payments/Invoice.service";
import * as Pricing from "./AdvertisementPricing.service";
import { assertTransition, canTransition, isModifiableDraft, isUnpaidDraftDeletable, isLiveCreativeEditable } from "./AdvertisementState.service";
import {
  applyNormalizedCreative,
  assertPublishableCreative,
  defaultCtaLabel,
  inferLegacyCtaType,
  normalizeCreativeInput,
  serializeCreative,
  type AdvertisementCreativeInput
} from "./advertisementCreative";

function httpError(message: string, status: number, code?: string) {
  return Object.assign(new Error(message), { status, code });
}

export type CreateAdvertisementInput = AdvertisementCreativeInput & {
  typeCode: string;
  title?: string | null;
  description?: string | null;
  ctaLabel?: string | null;
  destinationUrl?: string | null;
  mediaFileId?: number | null;
  placements?: AdvertisementPlacement[];
  billingMode?: "paid" | "complimentary";
  scheduledStartAt?: Date | string | null;
  scheduledEndAt?: Date | string | null;
};

function normalizeText(value: string, min: number, max: number, field: string): string {
  const v = String(value || "").trim();
  if (v.length < min || v.length > max) {
    throw httpError(`${field} must be ${min}–${max} characters`, 400, "INVALID_CONTENT");
  }
  return v;
}

function resolveDraftTitle(value: string | null | undefined, strict: boolean): string {
  if (strict) return normalizeText(String(value || ""), TITLE_MIN, TITLE_MAX, "Title");
  const v = String(value || "").trim();
  if (!v) return UNTITLED_DRAFT_TITLE;
  if (v.length > TITLE_MAX) {
    throw httpError(`Title must be at most ${TITLE_MAX} characters`, 400, "INVALID_CONTENT");
  }
  return v;
}

function resolveDraftDescription(value: string | null | undefined, strict: boolean): string {
  if (strict) return normalizeText(String(value || ""), DESCRIPTION_MIN, DESCRIPTION_MAX, "Description");
  const v = String(value || "").trim();
  if (v.length > DESCRIPTION_MAX) {
    throw httpError(`Description must be at most ${DESCRIPTION_MAX} characters`, 400, "INVALID_CONTENT");
  }
  return v;
}

async function assertType(typeCode: string): Promise<AdvertisementType> {
  const type = await AdvertisementType.findOne({ where: { code: typeCode } });
  if (!type || !type.isActive) {
    throw httpError("Unsupported advertisement type", 400, "INVALID_TYPE");
  }
  return type;
}

async function attachMedia(
  userId: number,
  mediaFileId: number | null | undefined,
  typeMediaKind?: "image" | "video" | "either"
) {
  if (!mediaFileId) return { mediaFileId: null, mediaUrl: null, thumbnailUrl: null, mediaKind: null };
  const file = await MediaFile.findByPk(mediaFileId);
  if (!file || file.userId !== userId) {
    throw httpError("Media file not found", 400, "INVALID_MEDIA");
  }
  if (file.module !== "advertisements") {
    throw httpError("Media must be uploaded for advertisements", 400, "INVALID_MEDIA");
  }
  if (file.processingStatus === "failed") {
    throw httpError("Media processing failed. Replace the file and try again.", 400, "MEDIA_FAILED");
  }
  if (typeMediaKind && !mediaFileMatchesTypeKind(file.fileType, typeMediaKind)) {
    throw httpError(
      typeMediaKind === "video"
        ? "This advertisement type requires a video"
        : "This advertisement type requires an image",
      400,
      "MEDIA_KIND_MISMATCH"
    );
  }
  const variants = (() => {
    try {
      return file.variantsJson
        ? (JSON.parse(file.variantsJson) as { thumb?: string; medium?: string })
        : null;
    } catch {
      return null;
    }
  })();
  return {
    mediaFileId: file.id,
    mediaUrl: file.fileUrl,
    thumbnailUrl: variants?.medium || variants?.thumb || file.fileUrl,
    mediaKind: file.fileType as "image" | "video"
  };
}

export async function createDraft(
  userId: number,
  input: CreateAdvertisementInput,
  options?: { billingMode?: "paid" | "complimentary"; strictContent?: boolean }
) {
  const type = await assertType(input.typeCode);
  const strictContent = options?.strictContent !== false;
  const title = resolveDraftTitle(input.title, strictContent);
  const description = resolveDraftDescription(input.description, strictContent);
  const creative = normalizeCreativeInput(input);
  const ctaType = creative.ctaType ?? null;
  const ctaLabel =
    creative.ctaLabel ||
    (input.ctaLabel?.trim()
      ? normalizeText(input.ctaLabel, CTA_MIN, CTA_MAX, "Call to action")
      : defaultCtaLabel(ctaType));
  const destinationUrl =
    creative.websiteUrl ??
    (input.destinationUrl?.trim() ? assertSafeHttpUrl(input.destinationUrl) : null);
  const media = await attachMedia(userId, input.mediaFileId, type.mediaKind);
  const now = new Date();
  const row = await Advertisement.create({
    userId,
    billingMode: options?.billingMode || input.billingMode || "paid",
    typeCode: type.code,
    businessName: creative.businessName ?? title,
    businessCategory: creative.businessCategory ?? null,
    title,
    shortDescription: creative.shortDescription ?? null,
    description,
    ctaLabel,
    contactPhone: creative.contactPhone ?? null,
    whatsappNumber: creative.whatsappNumber ?? null,
    contactEmail: creative.contactEmail ?? null,
    websiteUrl: creative.websiteUrl ?? destinationUrl,
    address: creative.address ?? null,
    city: creative.city ?? null,
    district: creative.district ?? null,
    state: creative.state ?? null,
    pincode: creative.pincode ?? null,
    latitude: creative.latitude ?? null,
    longitude: creative.longitude ?? null,
    ctaType,
    destinationUrl,
    ...media,
    placementsJson: input.placements?.length ? input.placements : ["home"],
    targetingJson: { ...DEFAULT_TARGETING },
    status: "DRAFT",
    pricingId: null,
    pricingSnapshot: null,
    durationDays: null,
    paymentOrderId: null,
    purchasedAt: null,
    approvedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    scheduledStartAt: null,
    actualStartAt: null,
    scheduledEndAt: null,
    actualEndAt: null,
    expiredAt: null,
    pausedAt: null,
    lastDeliveredAt: null,
    impressionsCount: 0,
    uniqueReachCount: 0,
    clicksCount: 0,
    createdAt: now,
    updatedAt: now
  });
  console.log("[advertisement] created", { id: row.id, userId, typeCode: type.code });
  return serializeAdvertiser(row);
}

export async function updateDraft(userId: number, id: number, input: Partial<CreateAdvertisementInput>) {
  const row = await getOwned(userId, id);
  if (isModifiableDraft(row.status)) {
    return applyDraftPatch(row, input, userId, { strictContent: false });
  }
  if (isLiveCreativeEditable(row.status)) {
    return submitLiveCreativeEdit(row, input, userId);
  }
  throw httpError("Only drafts and live advertisements can be edited", 400, "NOT_EDITABLE");
}

async function submitLiveCreativeEdit(
  row: Advertisement,
  input: Partial<CreateAdvertisementInput>,
  userId: number
) {
  if (input.typeCode && input.typeCode !== row.typeCode) {
    throw httpError("Live advertisements cannot change type. Create a new campaign.", 400, "TYPE_LOCKED");
  }
  const from = row.status;
  await applyDraftPatch(row, { ...input, typeCode: undefined }, userId, { strictContent: true });
  const latest = await Advertisement.findByPk(row.id);
  if (!latest) throw httpError("Advertisement not found", 404, "NOT_FOUND");
  assertPublishableCreative(latest);
  if (latest.mediaFileId) {
    const file = await MediaFile.findByPk(latest.mediaFileId);
    if (!file || file.processingStatus === "failed") {
      throw httpError("Media processing failed. Replace the file and try again.", 400, "MEDIA_FAILED");
    }
    if (file.processingStatus !== "completed") {
      throw httpError("Media is still processing. Wait until it is ready before submitting.", 400, "MEDIA_PROCESSING");
    }
  }
  assertTransition(from, "PENDING_REVIEW");
  const now = new Date();
  latest.status = "PENDING_REVIEW";
  latest.rejectionReason = null;
  latest.updatedAt = now;
  await latest.save();
  await AdvertisementModerationLog.create({
    advertisementId: latest.id,
    actor: "advertiser",
    action: "ADVERTISER_EDIT",
    fromStatus: from,
    toStatus: "PENDING_REVIEW",
    reason: null,
    createdAt: now
  });
  void Notifications.notifyAdvertisementSubmittedForReview(userId, latest.id).catch(() => {});
  console.log("[advertisement] live edit submitted", { id: latest.id, userId, from });
  return serializeAdvertiser(latest);
}

export async function adminUpdateCreative(id: number, input: Partial<CreateAdvertisementInput>, actor: string) {
  const row = await Advertisement.findByPk(id);
  if (!row) throw httpError("Advertisement not found", 404, "NOT_FOUND");
  if (row.status === "EXPIRED" || row.status === "CANCELLED" || row.status === "REJECTED") {
    throw httpError("This advertisement can no longer be edited", 400, "NOT_EDITABLE");
  }
  const updated = await applyDraftPatch(row, input, row.userId);
  if (input.scheduledStartAt !== undefined || input.scheduledEndAt !== undefined) {
    const next = await Advertisement.findByPk(id);
    if (next) {
      if (input.scheduledStartAt !== undefined) {
        next.scheduledStartAt = input.scheduledStartAt ? new Date(input.scheduledStartAt) : next.scheduledStartAt;
      }
      if (input.scheduledEndAt !== undefined) {
        next.scheduledEndAt = input.scheduledEndAt ? new Date(input.scheduledEndAt) : next.scheduledEndAt;
      }
      next.updatedAt = new Date();
      await next.save();
    }
  }
  await AdvertisementModerationLog.create({
    advertisementId: row.id,
    actor,
    action: "CREATIVE_UPDATED",
    fromStatus: row.status,
    toStatus: row.status,
    reason: null,
    createdAt: new Date()
  });
  const latest = await Advertisement.findByPk(id);
  return latest ? serializeAdvertiser(latest) : updated;
}

async function applyDraftPatch(
  row: Advertisement,
  input: Partial<CreateAdvertisementInput>,
  mediaOwnerId: number,
  options?: { strictContent?: boolean }
) {
  const strictContent = options?.strictContent !== false;
  let typeMediaKind: "image" | "video" | "either" | undefined;
  if (input.typeCode) {
    const type = await assertType(input.typeCode);
    row.typeCode = type.code;
    typeMediaKind = type.mediaKind;
  } else {
    const currentType = await AdvertisementType.findOne({ where: { code: row.typeCode } });
    typeMediaKind = currentType?.mediaKind;
  }
  if (input.title !== undefined) row.title = resolveDraftTitle(input.title, strictContent);
  if (input.description !== undefined) {
    row.description = resolveDraftDescription(input.description, strictContent);
  }
  const creative = normalizeCreativeInput(input);
  applyNormalizedCreative(row as unknown as Record<string, unknown>, creative);
  if (input.ctaLabel != null && input.ctaLabel.trim()) {
    row.ctaLabel = normalizeText(input.ctaLabel, CTA_MIN, CTA_MAX, "Call to action");
  } else if (creative.ctaType && !creative.ctaLabel) {
    row.ctaLabel = defaultCtaLabel(creative.ctaType);
  }
  const previousMedia = {
    mediaFileId: row.mediaFileId,
    mediaUrl: row.mediaUrl,
    thumbnailUrl: row.thumbnailUrl
  };
  if (input.mediaFileId !== undefined) {
    const media = await attachMedia(mediaOwnerId, input.mediaFileId, typeMediaKind);
    row.mediaFileId = media.mediaFileId;
    row.mediaUrl = media.mediaUrl;
    row.thumbnailUrl = media.thumbnailUrl;
    row.mediaKind = media.mediaKind;
  } else if (input.typeCode && row.mediaFileId) {
    await attachMedia(mediaOwnerId, row.mediaFileId, typeMediaKind);
  }
  if (input.placements?.length) row.placementsJson = input.placements;
  row.updatedAt = new Date();
  await row.save();
  if (
    input.mediaFileId !== undefined &&
    previousMedia.mediaFileId &&
    previousMedia.mediaFileId !== row.mediaFileId
  ) {
    await cleanupDraftMedia(mediaOwnerId, previousMedia).catch(() => undefined);
  }
  return serializeAdvertiser(row);
}

/**
 * Permanently delete a true unpaid DRAFT and its advertisement-owned media.
 * Not a status transition. PAYMENT_PENDING and all paid/lifecycle statuses are refused.
 * MySQL delete commits first; R2 cleanup is best-effort via the existing storage abstraction.
 */
export async function deleteDraft(userId: number, id: number): Promise<{ deleted: true }> {
  const row = await getOwned(userId, id);
  if (!isUnpaidDraftDeletable(row.status)) {
    throw httpError(
      "Only unpaid draft advertisements can be deleted",
      400,
      "NOT_DELETABLE"
    );
  }

  const mediaSnapshot = {
    mediaFileId: row.mediaFileId,
    mediaUrl: row.mediaUrl,
    thumbnailUrl: row.thumbnailUrl
  };
  const advertisementId = row.id;

  await sequelize.transaction(async (transaction) => {
    const locked = await Advertisement.findByPk(advertisementId, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!locked || locked.userId !== userId) {
      throw httpError("Advertisement not found", 404, "NOT_FOUND");
    }
    if (!isUnpaidDraftDeletable(locked.status)) {
      throw httpError(
        "Only unpaid draft advertisements can be deleted",
        400,
        "NOT_DELETABLE"
      );
    }
    await AdvertisementModerationLog.destroy({ where: { advertisementId }, transaction });
    await AdvertisementEvent.destroy({ where: { advertisementId }, transaction });
    await AdvertisementUniqueReach.destroy({ where: { advertisementId }, transaction });
    await AdvertisementDailyStat.destroy({ where: { advertisementId }, transaction });
    await AdvertisementExtension.destroy({ where: { advertisementId }, transaction });
    await AdvertisementEntitlement.destroy({ where: { advertisementId }, transaction });
    await AdvertisementUserExposure.destroy({ where: { advertisementId }, transaction });
    await AdvertisementReport.destroy({ where: { advertisementId }, transaction });
    await locked.destroy({ transaction });
  });

  await cleanupDraftMedia(userId, mediaSnapshot);
  console.log("[advertisement] draft deleted", { id: advertisementId, userId });
  return { deleted: true };
}

export async function cancelOwned(
  userId: number,
  id: number,
  reason?: string
): Promise<{ cancelled: true; status: "CANCELLED" }> {
  const ad = await sequelize.transaction(async (transaction) => {
    const row = await Advertisement.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!row || row.userId !== userId) {
      throw httpError("Advertisement not found", 404, "NOT_FOUND");
    }
    if (row.status === "CANCELLED") {
      throw httpError("This advertisement is already cancelled", 400, "ALREADY_CANCELLED");
    }
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
    await AdvertisementModerationLog.create(
      {
        advertisementId: row.id,
        actor: `user:${userId}`,
        action: "CANCEL",
        fromStatus: from,
        toStatus: "CANCELLED",
        reason: reason?.slice(0, 500) || "Advertiser deleted",
        createdAt: new Date()
      },
      { transaction }
    );
    return row;
  });
  console.log("[advertisement] cancelled by owner", { id: ad.id, userId });
  return { cancelled: true, status: "CANCELLED" };
}

/**
 * Unpaid drafts are hard-deleted with R2 cleanup.
 * Live/paid campaigns are cancelled so analytics and invoices remain.
 */
export async function deleteOwned(
  userId: number,
  id: number
): Promise<{ deleted: boolean; cancelled?: boolean; status?: string }> {
  const row = await getOwned(userId, id);
  if (isUnpaidDraftDeletable(row.status)) {
    return deleteDraft(userId, id);
  }
  if (!canTransition(row.status, "CANCELLED")) {
    throw httpError("This advertisement can no longer be deleted", 400, "NOT_DELETABLE");
  }
  const result = await cancelOwned(userId, id, "Advertiser deleted");
  return { deleted: false, cancelled: true, status: result.status };
}

/**
 * Reuse Media.service + R2 deleteMediaArtifacts. Missing R2 objects are ignored.
 * Per-URL so a variant/thumbnail 403 after the parent row is gone does not abort the rest.
 */
async function cleanupDraftMedia(
  userId: number,
  media: {
    mediaFileId: number | null;
    mediaUrl: string | null;
    thumbnailUrl: string | null;
  }
): Promise<void> {
  const urls = [...new Set([media.mediaUrl, media.thumbnailUrl].filter((u): u is string => Boolean(u?.trim())))];
  for (const url of urls) {
    try {
      await mediaService.deleteUserMediaUrls(userId, [url]);
    } catch (err) {
      console.warn(
        "[advertisement] media URL cleanup skipped",
        url,
        err instanceof Error ? err.message : err
      );
    }
  }
  if (!media.mediaFileId) return;
  const leftover = await MediaFile.findByPk(media.mediaFileId);
  if (!leftover || leftover.userId !== userId) return;
  try {
    await deleteMediaArtifacts(leftover.objectKey || leftover.fileUrl, leftover.variantsJson);
  } catch (err) {
    console.warn(
      "[advertisement] R2 artifact cleanup failed",
      leftover.id,
      err instanceof Error ? err.message : err
    );
  }
  await leftover.destroy().catch(() => undefined);
}

export async function getOwned(userId: number, id: number): Promise<Advertisement> {
  const row = await Advertisement.findByPk(id);
  if (!row || row.userId !== userId) {
    throw httpError("Advertisement not found", 404, "NOT_FOUND");
  }
  return row;
}

export async function listMine(userId: number, page = 1, limit = 20) {
  const safePage = Math.max(1, page);
  const safeLimit = Math.min(50, Math.max(1, limit));
  const { rows, count } = await Advertisement.findAndCountAll({
    where: { userId },
    order: [["id", "DESC"]],
    offset: (safePage - 1) * safeLimit,
    limit: safeLimit
  });
  return {
    items: rows.map(serializeAdvertiserList),
    page: safePage,
    limit: safeLimit,
    total: count
  };
}

export async function quotePrice(userId: number, id: number, pricingId: number) {
  const ad = await getOwned(userId, id);
  const pricing = await Pricing.resolvePurchasablePricing(pricingId, ad.typeCode);
  const snapshot = Pricing.snapshotFromPricing(pricing);
  const gstPercent = await getCentralGstPercent();
  const tax = splitGstInclusive(snapshot.pricePaise, gstPercent);
  return {
    advertisementId: ad.id,
    pricing: snapshot,
    amountPaise: snapshot.pricePaise,
    amountInr: snapshot.pricePaise / 100,
    currency: snapshot.currency,
    gstPercent: tax.gstPercent,
    gstAmountPaise: tax.gstAmountPaise,
    amountBeforeGstPaise: tax.amountBeforeGstPaise,
    durationDays: snapshot.durationDays
  };
}

function publicAdUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  return toPublicUrlIfR2(raw) ?? raw;
}

async function assertReadyForPayment(ad: Advertisement): Promise<void> {
  if (ad.billingMode === "complimentary") {
    throw httpError("This advertisement is managed by admin and does not use checkout", 400, "NOT_PAYABLE");
  }
  assertPublishableCreative(ad);
  if (ad.mediaFileId) {
    const file = await MediaFile.findByPk(ad.mediaFileId);
    if (!file || file.processingStatus === "failed") {
      throw httpError("Media processing failed. Replace the file and try again.", 400, "MEDIA_FAILED");
    }
    if (file.processingStatus !== "completed") {
      throw httpError("Media is still processing. Wait until it is ready before payment.", 400, "MEDIA_PROCESSING");
    }
  }
}

export async function createAdvertisementPayment(
  userId: number,
  id: number,
  pricingId: number,
  scheduledStartAt?: Date | null
) {
  return sequelize.transaction(async (transaction) => {
    // Same lock order as fulfillOrderLocked (payment rows, then advertisement)
    // so checkout and capture cannot deadlock.
    await PaymentOrder.findAll({
      where: { module: "advertisement", userId, referenceId: id },
      lock: Transaction.LOCK.UPDATE,
      order: [["id", "ASC"]],
      transaction
    });
    const ad = await Advertisement.findOne({
      where: { id, userId },
      lock: Transaction.LOCK.UPDATE,
      transaction
    });
    if (!ad) {
      throw httpError("Advertisement not found", 404, "NOT_FOUND");
    }
    if (ad.status !== "DRAFT" && ad.status !== "PAYMENT_PENDING") {
      throw httpError("Advertisement is not awaiting payment", 400, "NOT_PAYABLE");
    }
    await assertReadyForPayment(ad);

    const pricing = await Pricing.resolvePurchasablePricing(pricingId, ad.typeCode);
    const snapshot = Pricing.snapshotFromPricing(pricing);
    const gstPercent = await getCentralGstPercent();
    const tax = splitGstInclusive(snapshot.pricePaise, gstPercent);
    const start = scheduledStartAt && scheduledStartAt.getTime() > Date.now()
      ? scheduledStartAt
      : new Date();

    assertTransition(ad.status, "PAYMENT_PENDING");
    ad.status = "PAYMENT_PENDING";
    ad.pricingId = snapshot.pricingId;
    ad.pricingSnapshot = snapshot;
    ad.durationDays = snapshot.durationDays;
    ad.scheduledStartAt = start;
    ad.updatedAt = new Date();
    await ad.save({ transaction });

    const order = await Payment.createPaymentOrder({
      module: "advertisement",
      userId,
      referenceId: ad.id,
      product: `ad_pricing_${snapshot.pricingId}_v${snapshot.pricingVersion}`,
      amountPaise: snapshot.pricePaise,
      description: `Advertisement: ${ad.title} (${snapshot.durationDays} days)`,
      receiptPrefix: "ad",
      transaction,
      metadata: {
        advertisementId: ad.id,
        pricingId: snapshot.pricingId,
        pricingVersion: snapshot.pricingVersion,
        typeCode: snapshot.typeCode,
        durationDays: snapshot.durationDays,
        title: ad.title.slice(0, 80),
        gstPercent: tax.gstPercent,
        gstAmountPaise: tax.gstAmountPaise,
        amountBeforeGstPaise: tax.amountBeforeGstPaise,
        refundOnReject: snapshot.refundOnReject
      }
    });

    ad.paymentOrderId = order.orderId;
    ad.updatedAt = new Date();
    await ad.save({ transaction });

    console.log("[advertisement] payment initiated", {
      advertisementId: ad.id,
      orderId: order.orderId,
      amountPaise: order.amountPaise,
      pricingId: snapshot.pricingId,
      pricingVersion: snapshot.pricingVersion
    });

    return {
      advertisement: serializeAdvertiser(ad),
      quote: {
        amountPaise: order.amountPaise,
        amountInr: order.amountPaise / 100,
        currency: snapshot.currency,
        durationDays: snapshot.durationDays,
        gstPercent: tax.gstPercent,
        gstAmountPaise: tax.gstAmountPaise
      },
      order
    };
  });
}

export async function fulfillPaidAdvertisement(
  advertisementId: number,
  paymentOrderId: number,
  amountPaise: number,
  snapshot: AdvertisementPricingSnapshot,
  transaction: Transaction
): Promise<void> {
  const ad = await Advertisement.findByPk(advertisementId, {
    transaction,
    lock: Transaction.LOCK.UPDATE
  });
  if (!ad) {
    throw httpError("Advertisement not found for payment", 404, "NOT_FOUND");
  }
  if (
    ad.status === "PENDING_REVIEW" ||
    ad.status === "APPROVED" ||
    ad.status === "ACTIVE" ||
    ad.status === "SCHEDULED" ||
    ad.status === "PAUSED"
  ) {
    return;
  }
  // payment.failed can revert PAYMENT_PENDING → DRAFT before a later capture
  // on the same Razorpay order. Recover through the existing state machine.
  if (ad.status === "DRAFT") {
    assertTransition("DRAFT", "PAYMENT_PENDING");
    ad.status = "PAYMENT_PENDING";
  }
  if (ad.status !== "PAYMENT_PENDING" && ad.status !== "PAID") {
    throw httpError("Advertisement is not awaiting payment fulfillment", 409, "UNEXPECTED_STATUS");
  }

  const now = new Date();
  if (ad.status === "PAYMENT_PENDING") {
    assertTransition("PAYMENT_PENDING", "PAID");
    ad.status = "PAID";
  }
  assertTransition("PAID", "PENDING_REVIEW");
  ad.status = "PENDING_REVIEW";
  ad.paymentOrderId = paymentOrderId;
  ad.purchasedAt = now;
  ad.pricingSnapshot = mergePurchasedPricingSnapshot(ad.pricingSnapshot, snapshot);
  ad.durationDays = ad.pricingSnapshot.durationDays ?? snapshot.durationDays;
  ad.updatedAt = now;
  await ad.save({ transaction });

  const existing = await AdvertisementEntitlement.findOne({
    where: { advertisementId: ad.id },
    transaction
  });
  if (!existing) {
    await AdvertisementEntitlement.create(
      {
        advertisementId: ad.id,
        userId: ad.userId,
        paymentOrderId,
        product: `ad_pricing_${snapshot.pricingId}_v${snapshot.pricingVersion}`,
        durationDays: snapshot.durationDays,
        amountPaise,
        currency: snapshot.currency,
        status: "PENDING",
        startsAt: null,
        endsAt: null,
        createdAt: now,
        updatedAt: now
      },
      { transaction }
    );
  }

  await AdvertisementModerationLog.create(
    {
      advertisementId: ad.id,
      actor: "system",
      action: "PAID",
      fromStatus: "PAYMENT_PENDING",
      toStatus: "PENDING_REVIEW",
      reason: null,
      createdAt: now
    },
    { transaction }
  );
}

export async function revertPaymentFailure(advertisementId: number): Promise<void> {
  const ad = await Advertisement.findByPk(advertisementId);
  if (!ad || ad.status !== "PAYMENT_PENDING") return;
  ad.status = "DRAFT";
  ad.updatedAt = new Date();
  await ad.save();
}

export async function getDetailForAdvertiser(userId: number, id: number) {
  const ad = await getOwned(userId, id);
  const payment = ad.paymentOrderId
    ? await PaymentOrder.findByPk(ad.paymentOrderId)
    : null;
  const invoice = payment ? await Invoice.getInvoiceByPaymentOrderId(payment.id) : null;
  const entitlement = await AdvertisementEntitlement.findOne({
    where: { advertisementId: ad.id }
  });
  const logs = await AdvertisementModerationLog.findAll({
    where: { advertisementId: ad.id },
    order: [["id", "ASC"]],
    limit: 50
  });
  return {
    advertisement: serializeAdvertiser(ad),
    payment: payment
      ? {
          id: payment.id,
          status: payment.status,
          amountPaise: payment.amountPaise,
          razorpayOrderId: payment.razorpayOrderId,
          razorpayPaymentId: payment.razorpayPaymentId,
          currency: payment.currency
        }
      : null,
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
    timeline: logs.map((l) => ({
      action: l.action,
      fromStatus: l.fromStatus,
      toStatus: l.toStatus,
      actor: l.actor,
      reason: l.reason,
      createdAt: l.createdAt
    }))
  };
}

export async function getInvoiceForAdvertiser(userId: number, id: number) {
  const ad = await getOwned(userId, id);
  if (!invoiceAvailableForStatus(ad.status, ad.paymentOrderId) || !ad.paymentOrderId) {
    throw httpError("Invoice is available only after payment is complete.", 409, "INVOICE_NOT_READY");
  }
  const invoice = await PaymentInvoice.findOne({ where: { paymentOrderId: ad.paymentOrderId } });
  if (!invoice || invoice.userId !== userId) {
    throw httpError("Invoice is not available yet", 409, "INVOICE_NOT_READY");
  }
  return Invoice.serializeInvoice(invoice);
}

export function serializeAdvertiserList(ad: Advertisement) {
  const snap = ad.pricingSnapshot;
  const mediaUrl = publicAdUrl(ad.mediaUrl);
  const thumbnailUrl = publicAdUrl(ad.thumbnailUrl) || mediaUrl;
  return {
    id: ad.id,
    type: "ADVERTISEMENT" as const,
    title: ad.title,
    businessName: ad.businessName || ad.title,
    businessCategory: ad.businessCategory,
    thumbnailUrl,
    mediaKind: ad.mediaKind,
    typeCode: ad.typeCode,
    status: ad.status,
    billingMode: ad.billingMode || "paid",
    durationDays: ad.durationDays,
    amountPaise: snap?.pricePaise ?? null,
    currency: snap?.currency ?? "INR",
    scheduledStartAt: ad.scheduledStartAt,
    scheduledEndAt: ad.scheduledEndAt,
    impressions: ad.impressionsCount,
    uniqueReach: ad.uniqueReachCount,
    clicks: ad.clicksCount,
    reports: ad.reportsCount ?? 0,
    ctr: roundCtrPercent(ad.clicksCount, ad.impressionsCount),
    remainingDays: remainingDays(ad.scheduledEndAt),
    invoiceAvailable: invoiceAvailableForStatus(ad.status, ad.paymentOrderId),
    createdAt: ad.createdAt
  };
}

export function serializeAdvertiser(ad: Advertisement) {
  return {
    ...serializeAdvertiserList(ad),
    ...serializeCreative(ad),
    description: ad.description,
    shortDescription: ad.shortDescription,
    ctaLabel: ad.ctaLabel,
    ctaType: inferLegacyCtaType(ad),
    destinationUrl: ad.websiteUrl || ad.destinationUrl,
    websiteUrl: ad.websiteUrl || ad.destinationUrl,
    contactPhone: ad.contactPhone,
    whatsappNumber: ad.whatsappNumber,
    contactEmail: ad.contactEmail,
    address: ad.address,
    city: ad.city,
    district: ad.district,
    state: ad.state,
    pincode: ad.pincode,
    latitude: ad.latitude == null ? null : Number(ad.latitude),
    longitude: ad.longitude == null ? null : Number(ad.longitude),
    mediaUrl: publicAdUrl(ad.mediaUrl),
    mediaKind: ad.mediaKind,
    placements: ad.placementsJson,
    targeting: ad.targetingJson,
    pricingSnapshot: ad.pricingSnapshot,
    purchasedAt: ad.purchasedAt,
    approvedAt: ad.approvedAt,
    rejectedAt: ad.rejectedAt,
    rejectionReason: ad.rejectionReason,
    actualStartAt: ad.actualStartAt,
    actualEndAt: ad.actualEndAt,
    expiredAt: ad.expiredAt,
    pausedAt: ad.pausedAt,
    paymentOrderId: ad.paymentOrderId,
    mediaFileId: ad.mediaFileId
  };
}

export function serializeDeliveryCard(ad: Advertisement) {
  const mediaUrl = publicAdUrl(ad.mediaUrl);
  const thumbnailUrl = publicAdUrl(ad.thumbnailUrl) || mediaUrl;
  const creative = serializeCreative(ad);
  return {
    ...creative,
    id: ad.id,
    type: "ADVERTISEMENT" as const,
    title: ad.title,
    description: ad.description,
    shortDescription: ad.shortDescription,
    ctaLabel: creative.cta.label,
    mediaUrl,
    thumbnailUrl,
    mediaKind: ad.mediaKind,
    typeCode: ad.typeCode,
    sponsoredLabel: "Advertisement",
    destinationUrl: ad.websiteUrl || ad.destinationUrl,
    validUntil: ad.scheduledEndAt
  };
}
