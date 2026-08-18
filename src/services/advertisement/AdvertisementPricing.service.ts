import { Op } from "sequelize";
import { isPricingWindowActive, PRICE_MIN_PAISE } from "../../constants/advertisement.constants";
import { AdvertisementPricing, AdvertisementType } from "../../models/Advertisement.models";
import { audit } from "../platform/shared";
import { catalogCreativeOptions } from "./advertisementCreative";

export type PricingSnapshot = {
  pricingId: number;
  pricingVersion: number;
  typeCode: string;
  durationDays: number;
  pricePaise: number;
  currency: string;
  refundOnReject: boolean;
};

function httpError(message: string, status: number, code: string) {
  return Object.assign(new Error(message), { status, code });
}

export function isPricingCurrentlyActive(
  row: AdvertisementPricing,
  now = new Date()
): boolean {
  return isPricingWindowActive(row, now);
}

export function snapshotFromPricing(row: AdvertisementPricing): PricingSnapshot {
  return {
    pricingId: row.id,
    pricingVersion: row.version,
    typeCode: row.typeCode,
    durationDays: row.durationDays,
    pricePaise: row.pricePaise,
    currency: row.currency,
    refundOnReject: row.refundOnReject
  };
}

/** Server-side price. Never trusts client-supplied amounts. */
export async function resolvePurchasablePricing(
  pricingId: number,
  typeCode: string,
  now = new Date()
): Promise<AdvertisementPricing> {
  const row = await AdvertisementPricing.findByPk(pricingId);
  if (!row) throw httpError("Pricing option not found", 404, "PRICING_NOT_FOUND");
  if (row.typeCode !== typeCode) {
    throw httpError("Pricing does not match advertisement type", 400, "PRICING_TYPE_MISMATCH");
  }
  if (row.pricePaise < PRICE_MIN_PAISE) {
    throw httpError("Pricing is not purchasable", 400, "INVALID_PRICE");
  }
  if (!isPricingCurrentlyActive(row, now)) {
    throw httpError("Pricing is inactive or outside its effective window", 400, "PRICING_INACTIVE");
  }
  const type = await AdvertisementType.findOne({ where: { code: typeCode } });
  if (!type || !type.isActive) {
    throw httpError("Advertisement type is not available", 400, "TYPE_INACTIVE");
  }
  return row;
}

export async function listActiveCatalog() {
  const types = await AdvertisementType.findAll({
    where: { isActive: true },
    order: [
      ["sortOrder", "ASC"],
      ["id", "ASC"]
    ]
  });
  const now = new Date();
  const pricing = await AdvertisementPricing.findAll({
    where: {
      isActive: true,
      effectiveFrom: { [Op.lte]: now },
      [Op.or]: [{ effectiveTo: null }, { effectiveTo: { [Op.gt]: now } }]
    },
    order: [
      ["typeCode", "ASC"],
      ["durationDays", "ASC"]
    ]
  });
  return {
    types: types.map((t) => ({
      code: t.code,
      label: t.label,
      mediaKind: t.mediaKind
    })),
    pricing: pricing.map((p) => ({
      id: p.id,
      typeCode: p.typeCode,
      durationDays: p.durationDays,
      pricePaise: p.pricePaise,
      priceInr: p.pricePaise / 100,
      currency: p.currency,
      version: p.version,
      refundOnReject: p.refundOnReject,
      effectiveFrom: p.effectiveFrom,
      effectiveTo: p.effectiveTo
    })),
    ...catalogCreativeOptions()
  };
}

export async function listPricingAdmin() {
  const rows = await AdvertisementPricing.findAll({
    order: [
      ["typeCode", "ASC"],
      ["durationDays", "ASC"],
      ["id", "DESC"]
    ]
  });
  const types = await AdvertisementType.findAll({ order: [["sortOrder", "ASC"]] });
  return {
    types: types.map((t) => ({
      id: t.id,
      code: t.code,
      label: t.label,
      mediaKind: t.mediaKind,
      isActive: t.isActive,
      sortOrder: t.sortOrder
    })),
    pricing: rows.map(serializePricingAdmin)
  };
}

export function serializePricingAdmin(row: AdvertisementPricing) {
  return {
    id: row.id,
    typeCode: row.typeCode,
    durationDays: row.durationDays,
    pricePaise: row.pricePaise,
    priceInr: row.pricePaise / 100,
    currency: row.currency,
    isActive: row.isActive,
    refundOnReject: row.refundOnReject,
    version: row.version,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function assertPricingInput(input: {
  durationDays: number;
  pricePaise: number;
  typeCode: string;
}) {
  if (!Number.isInteger(input.durationDays) || input.durationDays < 1 || input.durationDays > 365) {
    throw httpError("Duration must be between 1 and 365 days", 400, "INVALID_DURATION");
  }
  if (!Number.isInteger(input.pricePaise) || input.pricePaise < PRICE_MIN_PAISE) {
    throw httpError("Price must be a positive amount", 400, "INVALID_PRICE");
  }
  if (!input.typeCode) throw httpError("Advertisement type is required", 400, "INVALID_TYPE");
}

export async function createPricingAdmin(
  input: {
    typeCode: string;
    durationDays: number;
    pricePaise: number;
    currency?: string;
    isActive?: boolean;
    refundOnReject?: boolean;
    effectiveFrom?: Date;
    effectiveTo?: Date | null;
  },
  adminEmail: string
) {
  assertPricingInput(input);
  const type = await AdvertisementType.findOne({ where: { code: input.typeCode } });
  if (!type) throw httpError("Unknown advertisement type", 400, "INVALID_TYPE");
  const now = new Date();
  const row = await AdvertisementPricing.create({
    typeCode: input.typeCode,
    durationDays: input.durationDays,
    pricePaise: input.pricePaise,
    currency: input.currency || "INR",
    isActive: input.isActive !== false,
    refundOnReject: Boolean(input.refundOnReject),
    version: 1,
    effectiveFrom: input.effectiveFrom ?? now,
    effectiveTo: input.effectiveTo ?? null,
    createdBy: adminEmail,
    updatedBy: adminEmail,
    createdAt: now,
    updatedAt: now
  });
  await audit(adminEmail, "ADVERTISEMENT_PRICING_CREATED", "advertisements", {
    id: row.id,
    typeCode: row.typeCode,
    durationDays: row.durationDays,
    pricePaise: row.pricePaise
  });
  console.log("[advertisement] pricing created", { id: row.id, adminEmail });
  return serializePricingAdmin(row);
}

export async function updatePricingAdmin(
  id: number,
  patch: {
    pricePaise?: number;
    isActive?: boolean;
    refundOnReject?: boolean;
    effectiveFrom?: Date;
    effectiveTo?: Date | null;
    reason?: string;
  },
  adminEmail: string
) {
  const row = await AdvertisementPricing.findByPk(id);
  if (!row) throw httpError("Pricing option not found", 404, "PRICING_NOT_FOUND");
  const oldPrice = row.pricePaise;
  if (patch.pricePaise != null) {
    if (!Number.isInteger(patch.pricePaise) || patch.pricePaise < PRICE_MIN_PAISE) {
      throw httpError("Price must be a positive amount", 400, "INVALID_PRICE");
    }
    row.pricePaise = patch.pricePaise;
    row.version = row.version + 1;
  }
  if (patch.isActive != null) row.isActive = patch.isActive;
  if (patch.refundOnReject != null) row.refundOnReject = patch.refundOnReject;
  if (patch.effectiveFrom) row.effectiveFrom = patch.effectiveFrom;
  if (patch.effectiveTo !== undefined) row.effectiveTo = patch.effectiveTo;
  row.updatedBy = adminEmail;
  row.updatedAt = new Date();
  await row.save();
  await audit(adminEmail, "ADVERTISEMENT_PRICING_UPDATED", "advertisements", {
    id: row.id,
    typeCode: row.typeCode,
    durationDays: row.durationDays,
    oldPricePaise: oldPrice,
    newPricePaise: row.pricePaise,
    version: row.version,
    reason: patch.reason ?? null
  });
  console.log("[advertisement] pricing updated", {
    id: row.id,
    oldPrice,
    newPrice: row.pricePaise,
    adminEmail
  });
  return serializePricingAdmin(row);
}
