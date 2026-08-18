import { z } from "zod";
import {
  ADDRESS_MAX,
  ADVERTISEMENT_BILLING_MODES,
  ADVERTISEMENT_CLICK_ACTIONS,
  ADVERTISEMENT_CTA_TYPES,
  ADVERTISEMENT_PLACEMENTS,
  ADVERTISEMENT_TYPE_CODES,
  BUSINESS_NAME_MAX,
  CATEGORY_MAX,
  CITY_MAX,
  CTA_MAX,
  CTA_MIN,
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  EMAIL_MAX,
  SHORT_DESCRIPTION_MAX,
  TITLE_MAX,
  TITLE_MIN,
  URL_MAX
} from "../constants/advertisement.constants";

const emptyToNull = (v: unknown) => (v === "" || v === undefined ? null : v);

const optionalText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable().optional());

const optionalUrl = z.preprocess(emptyToNull, z.string().trim().max(URL_MAX).nullable().optional());

const optionalCoord = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.coerce.number().finite().nullable().optional()
);

export const advertisementCreativeFields = {
  businessName: optionalText(BUSINESS_NAME_MAX),
  businessCategory: optionalText(CATEGORY_MAX),
  shortDescription: optionalText(SHORT_DESCRIPTION_MAX),
  contactPhone: optionalText(20),
  whatsappNumber: optionalText(20),
  contactEmail: optionalText(EMAIL_MAX),
  websiteUrl: optionalUrl,
  address: optionalText(ADDRESS_MAX),
  city: optionalText(CITY_MAX),
  district: optionalText(CITY_MAX),
  state: optionalText(CITY_MAX),
  pincode: optionalText(10),
  latitude: optionalCoord,
  longitude: optionalCoord,
  ctaType: z.preprocess(emptyToNull, z.enum(ADVERTISEMENT_CTA_TYPES).nullable().optional())
};

export const createAdvertisementSchema = z
  .object({
    typeCode: z.enum(ADVERTISEMENT_TYPE_CODES),
    title: z
      .string()
      .trim()
      .min(TITLE_MIN, { message: `Title must be at least ${TITLE_MIN} characters` })
      .max(TITLE_MAX, { message: `Title must be at most ${TITLE_MAX} characters` }),
    description: z
      .string()
      .trim()
      .min(DESCRIPTION_MIN, { message: `Description must be at least ${DESCRIPTION_MIN} characters` })
      .max(DESCRIPTION_MAX, { message: `Description must be at most ${DESCRIPTION_MAX} characters` }),
    ctaLabel: z
      .string()
      .trim()
      .min(CTA_MIN, { message: `Call to action must be at least ${CTA_MIN} characters` })
      .max(CTA_MAX, { message: `Call to action must be at most ${CTA_MAX} characters` })
      .optional(),
    destinationUrl: optionalUrl,
    mediaFileId: z.number().int().positive().optional().nullable(),
    placements: z.array(z.enum(ADVERTISEMENT_PLACEMENTS)).min(1).max(3).optional(),
    ...advertisementCreativeFields
  })
  .strict();

export const updateAdvertisementSchema = createAdvertisementSchema.partial().strict();

/** Advertiser save-as-draft: type is enough; title/description can be finished later. */
export const saveAdvertiserDraftSchema = z
  .object({
    typeCode: z.enum(ADVERTISEMENT_TYPE_CODES),
    title: optionalText(TITLE_MAX),
    description: optionalText(DESCRIPTION_MAX),
    ctaLabel: optionalText(CTA_MAX),
    destinationUrl: optionalUrl,
    mediaFileId: z.number().int().positive().optional().nullable(),
    placements: z.array(z.enum(ADVERTISEMENT_PLACEMENTS)).min(1).max(3).optional(),
    ...advertisementCreativeFields
  })
  .strict();

export const updateAdvertiserDraftSchema = saveAdvertiserDraftSchema.partial().strict();

export const adminUpdateAdvertisementSchema = createAdvertisementSchema
  .partial()
  .extend({
    scheduledStartAt: z.string().optional().nullable(),
    scheduledEndAt: z.string().optional().nullable()
  })
  .strict();

export const adminCreateAdvertisementSchema = createAdvertisementSchema
  .extend({
    userId: z.number().int().positive(),
    billingMode: z.enum(ADVERTISEMENT_BILLING_MODES).optional(),
    scheduledStartAt: z.string().optional().nullable(),
    scheduledEndAt: z.string().optional().nullable()
  })
  .strict();

export const adminPublishAdvertisementSchema = z
  .object({
    scheduledStartAt: z.string().optional().nullable(),
    scheduledEndAt: z.string().optional().nullable()
  })
  .strict();

export const quoteSchema = z
  .object({
    pricingId: z.number().int().positive()
  })
  .strict();

export const createAdPaymentSchema = z
  .object({
    pricingId: z.number().int().positive(),
    scheduledStartAt: z.string().optional().nullable()
  })
  .strict();

export const verifyAdPaymentSchema = z
  .object({
    razorpayOrderId: z.string().trim().min(1).max(64),
    razorpayPaymentId: z.string().trim().min(1).max(64),
    razorpaySignature: z.string().trim().min(1).max(256)
  })
  .strict();

export const adEventSchema = z
  .object({
    placement: z.enum(ADVERTISEMENT_PLACEMENTS).default("home"),
    platform: z.enum(["ios", "android", "web"]).optional(),
    eventId: z.string().trim().min(8).max(64).optional(),
    action: z.enum(ADVERTISEMENT_CLICK_ACTIONS).optional()
  })
  .strict();

export const adminPricingCreateSchema = z
  .object({
    typeCode: z.enum(ADVERTISEMENT_TYPE_CODES),
    durationDays: z.number().int().min(1).max(365),
    pricePaise: z.number().int().min(100),
    currency: z.literal("INR").optional(),
    isActive: z.boolean().optional(),
    refundOnReject: z.boolean().optional(),
    effectiveFrom: z.string().datetime().optional(),
    effectiveTo: z.string().datetime().optional().nullable()
  })
  .strict();

export const adminPricingUpdateSchema = z
  .object({
    pricePaise: z.number().int().min(100).optional(),
    isActive: z.boolean().optional(),
    refundOnReject: z.boolean().optional(),
    effectiveFrom: z.string().datetime().optional(),
    effectiveTo: z.string().datetime().optional().nullable(),
    reason: z.string().trim().max(500).optional()
  })
  .strict();

export const rejectAdvertisementSchema = z
  .object({
    reason: z.string().trim().min(3).max(500)
  })
  .strict();

export const extendAdvertisementSchema = z
  .object({
    extensionDays: z.number().int().min(1).max(365),
    reason: z.string().trim().min(3).max(500)
  })
  .strict();

export const refundAdvertisementSchema = z
  .object({
    reason: z.string().trim().min(3).max(500),
    paymentOrderId: z.number().int().positive().optional()
  })
  .strict();

export const reportAdvertisementSchema = z
  .object({
    reason: z.enum([
      "MISLEADING",
      "INAPPROPRIATE",
      "SPAM",
      "SCAM",
      "OFFENSIVE",
      "WRONG_CONTACT",
      "OTHER"
    ]),
    details: z.string().trim().max(500).optional().nullable()
  })
  .strict();

export const reviewAdvertisementReportSchema = z
  .object({
    status: z.enum(["UNDER_REVIEW", "RESOLVED", "DISMISSED"]),
    notes: z.string().trim().max(500).optional().nullable(),
    advertisementAction: z.enum(["keep", "pause", "reject", "cancel"]).optional().nullable(),
    rejectReason: z.string().trim().min(3).max(500).optional().nullable()
  })
  .strict();
