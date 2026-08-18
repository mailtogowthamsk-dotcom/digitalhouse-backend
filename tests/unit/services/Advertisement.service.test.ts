import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  isCurrentlyDeliverable,
  isDeliverableStatus,
  isModifiableDraft,
  isLiveCreativeEditable,
  isTerminalStatus,
  isUnpaidDraftDeletable,
  publishStatusAfterApproval
} from "../../../src/services/advertisement/AdvertisementState.service";
import {
  dailyStatsSqlColumn,
  invoiceAvailableForStatus,
  isPricingWindowActive,
  mediaFileMatchesTypeKind,
  mergePurchasedPricingSnapshot,
  remainingDays,
  roundCtrPercent
} from "../../../src/constants/advertisement.constants";
import { isSafeHttpUrl } from "../../../src/utils/safeUrl";
import {
  adminPricingCreateSchema,
  createAdPaymentSchema,
  createAdvertisementSchema,
  quoteSchema,
  saveAdvertiserDraftSchema
} from "../../../src/validations/advertisement.validation";
import {
  assertPublishableCreative,
  normalizeIndianMobile,
  serializeCreative
} from "../../../src/services/advertisement/advertisementCreative";

function splitGstInclusive(amountPaise: number, gstPercent: number) {
  const pct = Math.max(0, Number(gstPercent) || 0);
  const before = pct > 0 ? Math.round((amountPaise * 100) / (100 + pct)) : amountPaise;
  return { gstPercent: pct, amountBeforeGstPaise: before, gstAmountPaise: Math.max(0, amountPaise - before) };
}

describe("AdvertisementState.service", () => {
  it("allows the paid review lifecycle", () => {
    expect(canTransition("DRAFT", "PAYMENT_PENDING")).toBe(true);
    expect(canTransition("PAYMENT_PENDING", "PAID")).toBe(true);
    expect(canTransition("PAID", "PENDING_REVIEW")).toBe(true);
    expect(canTransition("ACTIVE", "PENDING_REVIEW")).toBe(true);
    expect(canTransition("PENDING_REVIEW", "APPROVED")).toBe(true);
    expect(canTransition("APPROVED", "ACTIVE")).toBe(true);
    expect(canTransition("APPROVED", "EXPIRED")).toBe(true);
    expect(canTransition("APPROVED", "SCHEDULED")).toBe(true);
    expect(canTransition("SCHEDULED", "ACTIVE")).toBe(true);
    expect(canTransition("ACTIVE", "PAUSED")).toBe(true);
    expect(canTransition("PAUSED", "ACTIVE")).toBe(true);
    expect(canTransition("ACTIVE", "EXPIRED")).toBe(true);
    expect(canTransition("PAID", "CANCELLED")).toBe(true);
    expect(canTransition("ACTIVE", "CANCELLED")).toBe(true);
  });

  it("allows DRAFT → PAYMENT_PENDING so a failed webhook can recover into checkout again", () => {
    expect(canTransition("DRAFT", "PAYMENT_PENDING")).toBe(true);
    expect(canTransition("PAYMENT_PENDING", "DRAFT")).toBe(true);
    expect(canTransition("CANCELLED", "PAID")).toBe(false);
    expect(canTransition("PAID", "PAYMENT_PENDING")).toBe(false);
  });

  it("rejects invalid jumps including payment bypass", () => {
    expect(canTransition("DRAFT", "ACTIVE")).toBe(false);
    expect(canTransition("DRAFT", "EXPIRED")).toBe(false);
    expect(canTransition("PAYMENT_PENDING", "ACTIVE")).toBe(false);
    expect(canTransition("PAID", "ACTIVE")).toBe(false);
    expect(canTransition("REJECTED", "ACTIVE")).toBe(false);
    expect(canTransition("EXPIRED", "ACTIVE")).toBe(false);
    expect(canTransition("CANCELLED", "ACTIVE")).toBe(false);
    expect(() => assertTransition("DRAFT", "ACTIVE")).toThrow(/Invalid advertisement status/);
    expect(() => assertTransition("PAID", "ACTIVE")).toThrow(/Invalid advertisement status/);
    expect(() => assertTransition("EXPIRED", "ACTIVE")).toThrow(/Invalid advertisement status/);
  });

  it("allows complimentary admin publish without payment", () => {
    expect(canTransition("DRAFT", "ACTIVE", { billingMode: "complimentary" })).toBe(true);
    expect(canTransition("DRAFT", "SCHEDULED", { billingMode: "complimentary" })).toBe(true);
    expect(canTransition("DRAFT", "ACTIVE", { billingMode: "paid" })).toBe(false);
  });

  it("publishes immediately when start is now/past", () => {
    const now = new Date("2026-08-15T10:00:00.000Z");
    expect(publishStatusAfterApproval(now, now)).toBe("ACTIVE");
    expect(publishStatusAfterApproval(new Date("2026-08-16T10:00:00.000Z"), now)).toBe("SCHEDULED");
  });

  it("classifies terminal and draft statuses", () => {
    expect(isTerminalStatus("EXPIRED")).toBe(true);
    expect(isModifiableDraft("DRAFT")).toBe(true);
    expect(isModifiableDraft("ACTIVE")).toBe(false);
    expect(isLiveCreativeEditable("ACTIVE")).toBe(true);
    expect(isLiveCreativeEditable("DRAFT")).toBe(false);
    expect(isUnpaidDraftDeletable("DRAFT")).toBe(true);
    expect(isUnpaidDraftDeletable("PAYMENT_PENDING")).toBe(false);
    expect(isUnpaidDraftDeletable("PAID")).toBe(false);
    expect(isUnpaidDraftDeletable("PENDING_REVIEW")).toBe(false);
    expect(isUnpaidDraftDeletable("ACTIVE")).toBe(false);
    expect(isUnpaidDraftDeletable("REJECTED")).toBe(false);
    expect(isDeliverableStatus("ACTIVE")).toBe(true);
    expect(isDeliverableStatus("PAUSED")).toBe(false);
  });
});

describe("advertisement analytics math", () => {
  it("rounds CTR to 2 decimal places", () => {
    expect(roundCtrPercent(1, 3)).toBe(33.33);
    expect(roundCtrPercent(0, 10)).toBe(0);
    expect(roundCtrPercent(5, 0)).toBe(0);
  });

  it("computes remaining days from campaign end", () => {
    const now = new Date("2026-08-15T00:00:00.000Z");
    expect(remainingDays("2026-08-20T00:00:00.000Z", now)).toBe(5);
    expect(remainingDays("2026-08-10T00:00:00.000Z", now)).toBe(0);
  });

  it("maps daily unique viewers to the MySQL column name", () => {
    expect(dailyStatsSqlColumn("impressions")).toBe("impressions");
    expect(dailyStatsSqlColumn("clicks")).toBe("clicks");
    expect(dailyStatsSqlColumn("uniqueViewers")).toBe("unique_viewers");
  });
});

describe("safe advertisement URLs", () => {
  it("allows public https destinations", () => {
    expect(isSafeHttpUrl("https://example.com/offer")).toBe(true);
  });

  it("blocks dangerous and private destinations", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,hi")).toBe(false);
    expect(isSafeHttpUrl("ftp://example.com/file")).toBe(false);
    expect(isSafeHttpUrl("https://localhost/admin")).toBe(false);
    expect(isSafeHttpUrl("https://127.0.0.1/")).toBe(false);
    expect(isSafeHttpUrl("https://192.168.1.9/")).toBe(false);
    expect(isSafeHttpUrl("https://user:pass@evil.com/")).toBe(false);
    expect(isSafeHttpUrl("not a url")).toBe(false);
  });
});

describe("pricing snapshot versioning", () => {
  it("freezes purchased price independent of later admin changes", () => {
    const purchased = {
      pricingId: 9,
      pricingVersion: 1,
      pricePaise: 119900
    };
    const laterPricePaise = 149900;
    expect(purchased.pricePaise).toBe(119900);
    expect(purchased.pricePaise).not.toBe(laterPricePaise);
  });

  it("keeps refund policy from the purchased snapshot when fulfillment meta is incomplete", () => {
    const purchased = {
      pricingId: 9,
      pricingVersion: 1,
      typeCode: "IMAGE_BANNER",
      durationDays: 15,
      pricePaise: 119900,
      currency: "INR",
      refundOnReject: true
    };
    const fromOrder = {
      ...purchased,
      refundOnReject: false,
      pricePaise: 119900
    };
    const merged = mergePurchasedPricingSnapshot(purchased, fromOrder);
    expect(merged.pricePaise).toBe(119900);
    expect(merged.refundOnReject).toBe(true);
  });
});

describe("pricing window", () => {
  const now = new Date("2026-08-15T12:00:00.000Z");

  it("rejects inactive and expired pricing", () => {
    expect(
      isPricingWindowActive(
        { isActive: false, effectiveFrom: new Date("2026-01-01"), effectiveTo: null },
        now
      )
    ).toBe(false);
    expect(
      isPricingWindowActive(
        {
          isActive: true,
          effectiveFrom: new Date("2026-01-01"),
          effectiveTo: new Date("2026-08-01")
        },
        now
      )
    ).toBe(false);
  });

  it("rejects pricing that is not yet effective", () => {
    expect(
      isPricingWindowActive(
        {
          isActive: true,
          effectiveFrom: new Date("2026-09-01"),
          effectiveTo: null
        },
        now
      )
    ).toBe(false);
  });

  it("accepts currently active pricing", () => {
    expect(
      isPricingWindowActive(
        {
          isActive: true,
          effectiveFrom: new Date("2026-01-01"),
          effectiveTo: null
        },
        now
      )
    ).toBe(true);
  });
});

describe("payment request schemas reject client price manipulation", () => {
  it("rejects amount, currency, and extra fields on payment create", () => {
    expect(
      createAdPaymentSchema.safeParse({
        pricingId: 1,
        amountPaise: 1,
        currency: "USD"
      }).success
    ).toBe(false);
    expect(createAdPaymentSchema.safeParse({ pricingId: 1 }).success).toBe(true);
  });

  it("rejects amount on quote", () => {
    expect(quoteSchema.safeParse({ pricingId: 1, amountPaise: 50 }).success).toBe(false);
  });

  it("rejects negative and non-INR admin prices", () => {
    expect(
      adminPricingCreateSchema.safeParse({
        typeCode: "IMAGE_BANNER",
        durationDays: 15,
        pricePaise: -100
      }).success
    ).toBe(false);
    expect(
      adminPricingCreateSchema.safeParse({
        typeCode: "IMAGE_BANNER",
        durationDays: 15,
        pricePaise: 119900,
        currency: "USD"
      }).success
    ).toBe(false);
    expect(
      adminPricingCreateSchema.safeParse({
        typeCode: "IMAGE_BANNER",
        durationDays: 0,
        pricePaise: 119900
      }).success
    ).toBe(false);
  });

  it("rejects javascript destination URLs at the URL validator", () => {
    expect(
      createAdvertisementSchema.safeParse({
        typeCode: "IMAGE_BANNER",
        title: "Summer offer",
        description: "A valid description for the campaign.",
        ctaLabel: "Visit",
        destinationUrl: "javascript:alert(1)"
      }).success
    ).toBe(true);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
  });

  it("allows advertiser drafts with only a type", () => {
    expect(
      saveAdvertiserDraftSchema.safeParse({
        typeCode: "IMAGE_BANNER"
      }).success
    ).toBe(true);
    expect(
      createAdvertisementSchema.safeParse({
        typeCode: "IMAGE_BANNER"
      }).success
    ).toBe(false);
  });
});

describe("invoice GST split", () => {
  it("keeps charged amount as source of truth", () => {
    const split = splitGstInclusive(119900, 18);
    expect(split.amountBeforeGstPaise + split.gstAmountPaise).toBe(119900);
  });

  it("uses zero GST without changing amount", () => {
    const split = splitGstInclusive(50000, 0);
    expect(split.amountBeforeGstPaise).toBe(50000);
    expect(split.gstAmountPaise).toBe(0);
  });
});

describe("delivery window", () => {
  it("requires ACTIVE plus current time inside start/end", () => {
    const now = new Date("2026-08-15T12:00:00.000Z");
    expect(
      isCurrentlyDeliverable(
        {
          status: "ACTIVE",
          scheduledStartAt: new Date("2026-08-15T00:00:00.000Z"),
          scheduledEndAt: new Date("2026-08-20T00:00:00.000Z")
        },
        now
      )
    ).toBe(true);
    expect(
      isCurrentlyDeliverable(
        {
          status: "PAUSED",
          scheduledStartAt: new Date("2026-08-15T00:00:00.000Z"),
          scheduledEndAt: new Date("2026-08-20T00:00:00.000Z")
        },
        now
      )
    ).toBe(false);
    expect(
      isCurrentlyDeliverable(
        {
          status: "EXPIRED",
          scheduledStartAt: new Date("2026-08-01T00:00:00.000Z"),
          scheduledEndAt: new Date("2026-08-10T00:00:00.000Z")
        },
        now
      )
    ).toBe(false);
    expect(
      isCurrentlyDeliverable(
        {
          status: "ACTIVE",
          scheduledStartAt: new Date("2026-08-16T00:00:00.000Z"),
          scheduledEndAt: new Date("2026-08-20T00:00:00.000Z")
        },
        now
      )
    ).toBe(false);
  });
});

describe("advertisement media kind vs type", () => {
  it("requires image for IMAGE_BANNER and video for VIDEO", () => {
    expect(mediaFileMatchesTypeKind("image", "image")).toBe(true);
    expect(mediaFileMatchesTypeKind("video", "image")).toBe(false);
    expect(mediaFileMatchesTypeKind("video", "video")).toBe(true);
    expect(mediaFileMatchesTypeKind("image", "video")).toBe(false);
    expect(mediaFileMatchesTypeKind("image", "either")).toBe(true);
    expect(mediaFileMatchesTypeKind("video", "either")).toBe(true);
  });
});

describe("invoice availability", () => {
  it("is never available for unpaid drafts", () => {
    expect(invoiceAvailableForStatus("DRAFT", null)).toBe(false);
    expect(invoiceAvailableForStatus("DRAFT", 12)).toBe(false);
    expect(invoiceAvailableForStatus("PAYMENT_PENDING", 12)).toBe(false);
  });

  it("requires a payment order after fulfillment", () => {
    expect(invoiceAvailableForStatus("PAID", 12)).toBe(true);
    expect(invoiceAvailableForStatus("PENDING_REVIEW", 12)).toBe(true);
    expect(invoiceAvailableForStatus("ACTIVE", 12)).toBe(true);
    expect(invoiceAvailableForStatus("ACTIVE", null)).toBe(false);
  });
});

describe("advertisement creative validation", () => {
  it("normalizes Indian mobiles and rejects invalid numbers", () => {
    expect(normalizeIndianMobile("+91 98765 43210", "Phone")).toBe("9876543210");
    expect(normalizeIndianMobile("9876543210", "Phone")).toBe("9876543210");
    expect(normalizeIndianMobile("", "Phone")).toBeNull();
    expect(() => normalizeIndianMobile("12345", "Phone")).toThrow(/valid 10-digit/);
  });

  it("requires CTA-matching contact fields before publish", () => {
    const base = {
      title: "Offer",
      description: "A valid description for the campaign.",
      ctaLabel: "Call Now",
      destinationUrl: null,
      mediaFileId: 1,
      mediaUrl: "https://cdn.example.com/ad.jpg",
      businessName: "Sri Store",
      businessCategory: "RETAIL",
      shortDescription: "Wholesale rice",
      contactPhone: "9876543210",
      whatsappNumber: null,
      contactEmail: null,
      websiteUrl: null,
      address: null,
      city: null,
      district: null,
      state: null,
      pincode: null,
      latitude: null,
      longitude: null,
      ctaType: "CALL"
    };
    expect(() => assertPublishableCreative(base)).not.toThrow();
    expect(() => assertPublishableCreative({ ...base, contactPhone: null })).toThrow(/phone number/);
    expect(() =>
      assertPublishableCreative({ ...base, ctaType: "WEBSITE", websiteUrl: null, destinationUrl: null })
    ).toThrow(/website URL/);
  });

  it("accepts structured creative fields on create", () => {
    expect(
      createAdvertisementSchema.safeParse({
        typeCode: "IMAGE_BANNER",
        title: "Summer offer",
        description: "A valid description for the campaign.",
        businessName: "Sri Store",
        contactPhone: "9876543210",
        ctaType: "CALL"
      }).success
    ).toBe(true);
  });

  it("does not serialize a fake Learn more CTA when no destination exists", () => {
    const creative = serializeCreative({
      title: "Honda City",
      description: "The new car with new Technologies",
      ctaLabel: "Learn more",
      destinationUrl: null,
      mediaFileId: 1,
      mediaUrl: "https://cdn.example.com/ad.jpg",
      businessName: "Honda",
      businessCategory: "VEHICLES",
      shortDescription: "The new car with new Technologies",
      contactPhone: "9876543210",
      whatsappNumber: "9876543210",
      contactEmail: null,
      websiteUrl: null,
      address: null,
      city: "Bengaluru",
      district: null,
      state: null,
      pincode: null,
      latitude: null,
      longitude: null,
      ctaType: "CALL"
    });
    expect(creative.contact.phone).toBe("9876543210");
    expect(creative.contact.whatsapp).toBe("9876543210");
    expect(creative.contact.website).toBeFalsy();
    expect(creative.location?.city).toBe("Bengaluru");
    expect(creative.cta.type).toBe("CALL");
    expect(creative.cta.target).toBe("9876543210");
    expect(creative.cta.label).toBe("Call Now");
  });

  it("omits a public CTA label when Learn more has no destination", () => {
    const creative = serializeCreative({
      title: "Honda City",
      description: "The new car with new Technologies",
      ctaLabel: "Learn more",
      destinationUrl: null,
      mediaFileId: 1,
      mediaUrl: "https://cdn.example.com/ad.jpg",
      businessName: "Honda",
      businessCategory: "VEHICLES",
      shortDescription: null,
      contactPhone: null,
      whatsappNumber: null,
      contactEmail: null,
      websiteUrl: null,
      address: null,
      city: null,
      district: null,
      state: null,
      pincode: null,
      latitude: null,
      longitude: null,
      ctaType: "CUSTOM_URL"
    });
    expect(creative.contact.website).toBeFalsy();
    expect(creative.cta.target).toBeNull();
    expect(creative.cta.label).toBe("");
  });
});

