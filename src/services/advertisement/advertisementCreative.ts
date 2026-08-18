import {
  ADDRESS_MAX,
  ADVERTISEMENT_BUSINESS_CATEGORIES,
  ADVERTISEMENT_CTA_LABELS,
  ADVERTISEMENT_CTA_TYPES,
  BUSINESS_NAME_MAX,
  BUSINESS_NAME_MIN,
  CATEGORY_MAX,
  CITY_MAX,
  CTA_MAX,
  CTA_MIN,
  EMAIL_MAX,
  INDIAN_MOBILE_RE,
  PINCODE_RE,
  SHORT_DESCRIPTION_MAX,
  URL_MAX,
  type AdvertisementCtaType
} from "../../constants/advertisement.constants";
import { assertSafeHttpUrl } from "../../utils/safeUrl";

function httpError(message: string, status: number, code?: string) {
  return Object.assign(new Error(message), { status, code });
}

export type AdvertisementCreativeInput = {
  businessName?: string | null;
  businessCategory?: string | null;
  shortDescription?: string | null;
  contactPhone?: string | null;
  whatsappNumber?: string | null;
  contactEmail?: string | null;
  websiteUrl?: string | null;
  destinationUrl?: string | null;
  address?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  ctaType?: string | null;
  ctaLabel?: string | null;
};

export type AdvertisementCreativeRow = {
  title: string;
  description: string;
  ctaLabel: string;
  destinationUrl: string | null;
  mediaFileId: number | null;
  mediaUrl: string | null;
  businessName: string | null;
  businessCategory: string | null;
  shortDescription: string | null;
  contactPhone: string | null;
  whatsappNumber: string | null;
  contactEmail: string | null;
  websiteUrl: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  ctaType: string | null;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
};

function emptyToNull(value: string | null | undefined): string | null {
  const v = String(value ?? "").trim();
  return v ? v : null;
}

export function normalizeOptionalText(
  value: string | null | undefined,
  max: number,
  field: string,
  min = 0
): string | null {
  const v = emptyToNull(value);
  if (!v) return null;
  if (v.length < min || v.length > max) {
    throw httpError(`${field} must be ${min}–${max} characters`, 400, "INVALID_CONTENT");
  }
  return v;
}

export function normalizeIndianMobile(raw: string | null | undefined, field: string): string | null {
  const v = emptyToNull(raw);
  if (!v) return null;
  const digits = v.replace(/\D/g, "");
  const national =
    digits.length >= 12 && digits.startsWith("91") ? digits.slice(-10) : digits.slice(-10);
  if (!INDIAN_MOBILE_RE.test(national)) {
    throw httpError(`${field} must be a valid 10-digit Indian mobile number`, 400, "INVALID_PHONE");
  }
  return national;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = emptyToNull(raw);
  if (!v) return null;
  if (v.length > EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    throw httpError("Enter a valid email address", 400, "INVALID_EMAIL");
  }
  return v.toLowerCase();
}

export function normalizeWebsite(raw: string | null | undefined): string | null {
  const v = emptyToNull(raw);
  if (!v) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  return assertSafeHttpUrl(withScheme, URL_MAX);
}

export function normalizePincode(raw: string | null | undefined): string | null {
  const v = emptyToNull(raw);
  if (!v) return null;
  if (!PINCODE_RE.test(v)) {
    throw httpError("Pincode must be 6 digits", 400, "INVALID_PINCODE");
  }
  return v;
}

export function normalizeCoordinate(
  value: number | string | null | undefined,
  field: "latitude" | "longitude"
): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw httpError(`${field} is invalid`, 400, "INVALID_LOCATION");
  }
  if (field === "latitude" && (n < -90 || n > 90)) {
    throw httpError("Latitude must be between -90 and 90", 400, "INVALID_LOCATION");
  }
  if (field === "longitude" && (n < -180 || n > 180)) {
    throw httpError("Longitude must be between -180 and 180", 400, "INVALID_LOCATION");
  }
  return Math.round(n * 1e7) / 1e7;
}

export function isAdvertisementCtaType(value: string | null | undefined): value is AdvertisementCtaType {
  return Boolean(value && (ADVERTISEMENT_CTA_TYPES as readonly string[]).includes(value));
}

export function defaultCtaLabel(ctaType: AdvertisementCtaType | null | undefined): string {
  if (ctaType && ADVERTISEMENT_CTA_LABELS[ctaType]) return ADVERTISEMENT_CTA_LABELS[ctaType];
  return "Learn more";
}

export function catalogCreativeOptions() {
  return {
    ctaTypes: ADVERTISEMENT_CTA_TYPES.map((code) => ({
      code,
      label: ADVERTISEMENT_CTA_LABELS[code]
    })),
    businessCategories: ADVERTISEMENT_BUSINESS_CATEGORIES.map((c) => ({
      code: c.code,
      label: c.label
    }))
  };
}

export function normalizeCreativeInput(input: AdvertisementCreativeInput): {
  businessName: string | null;
  businessCategory: string | null;
  shortDescription: string | null;
  contactPhone: string | null;
  whatsappNumber: string | null;
  contactEmail: string | null;
  websiteUrl: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  ctaType: AdvertisementCtaType | null;
  ctaLabel: string | null;
  destinationUrl: string | null;
} {
  const websiteUrl =
    input.websiteUrl !== undefined
      ? normalizeWebsite(input.websiteUrl)
      : input.destinationUrl !== undefined
        ? normalizeWebsite(input.destinationUrl)
        : undefined;
  const ctaTypeRaw = emptyToNull(input.ctaType);
  if (ctaTypeRaw && !isAdvertisementCtaType(ctaTypeRaw)) {
    throw httpError("Unsupported call-to-action type", 400, "INVALID_CTA");
  }
  const category = normalizeOptionalText(input.businessCategory, CATEGORY_MAX, "Business category");
  if (
    category &&
    !ADVERTISEMENT_BUSINESS_CATEGORIES.some((c) => c.code === category || c.label === category)
  ) {
    throw httpError("Unsupported business category", 400, "INVALID_CATEGORY");
  }
  const resolvedCategory =
    ADVERTISEMENT_BUSINESS_CATEGORIES.find((c) => c.code === category || c.label === category)?.code ??
    category;

  let ctaLabel: string | null | undefined;
  if (input.ctaLabel !== undefined) {
    const trimmed = emptyToNull(input.ctaLabel);
    ctaLabel = trimmed
      ? normalizeOptionalText(trimmed, CTA_MAX, "Call to action", CTA_MIN)
      : null;
  }

  const destinationUrl =
    websiteUrl !== undefined
      ? websiteUrl
      : input.destinationUrl !== undefined
        ? normalizeWebsite(input.destinationUrl)
        : undefined;

  return {
    businessName:
      input.businessName !== undefined
        ? normalizeOptionalText(input.businessName, BUSINESS_NAME_MAX, "Business name", BUSINESS_NAME_MIN)
        : undefined as unknown as string | null,
    businessCategory: input.businessCategory !== undefined ? resolvedCategory : (undefined as unknown as string | null),
    shortDescription:
      input.shortDescription !== undefined
        ? normalizeOptionalText(input.shortDescription, SHORT_DESCRIPTION_MAX, "Short description")
        : (undefined as unknown as string | null),
    contactPhone:
      input.contactPhone !== undefined
        ? normalizeIndianMobile(input.contactPhone, "Phone")
        : (undefined as unknown as string | null),
    whatsappNumber:
      input.whatsappNumber !== undefined
        ? normalizeIndianMobile(input.whatsappNumber, "WhatsApp")
        : (undefined as unknown as string | null),
    contactEmail:
      input.contactEmail !== undefined ? normalizeEmail(input.contactEmail) : (undefined as unknown as string | null),
    websiteUrl: websiteUrl as string | null,
    address:
      input.address !== undefined
        ? normalizeOptionalText(input.address, ADDRESS_MAX, "Address")
        : (undefined as unknown as string | null),
    city:
      input.city !== undefined
        ? normalizeOptionalText(input.city, CITY_MAX, "City")
        : (undefined as unknown as string | null),
    district:
      input.district !== undefined
        ? normalizeOptionalText(input.district, CITY_MAX, "District")
        : (undefined as unknown as string | null),
    state:
      input.state !== undefined
        ? normalizeOptionalText(input.state, CITY_MAX, "State")
        : (undefined as unknown as string | null),
    pincode: input.pincode !== undefined ? normalizePincode(input.pincode) : (undefined as unknown as string | null),
    latitude:
      input.latitude !== undefined
        ? normalizeCoordinate(input.latitude, "latitude")
        : (undefined as unknown as number | null),
    longitude:
      input.longitude !== undefined
        ? normalizeCoordinate(input.longitude, "longitude")
        : (undefined as unknown as number | null),
    ctaType: input.ctaType !== undefined ? (ctaTypeRaw as AdvertisementCtaType | null) : (undefined as unknown as AdvertisementCtaType | null),
    ctaLabel: ctaLabel as string | null,
    destinationUrl: destinationUrl as string | null
  };
}

function hasLocation(ad: AdvertisementCreativeRow): boolean {
  const lat = ad.latitude == null ? null : Number(ad.latitude);
  const lng = ad.longitude == null ? null : Number(ad.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return true;
  return Boolean(emptyToNull(ad.address) || emptyToNull(ad.city) || emptyToNull(ad.pincode));
}

export function inferLegacyCtaType(ad: AdvertisementCreativeRow): AdvertisementCtaType {
  if (isAdvertisementCtaType(ad.ctaType)) return ad.ctaType;
  if (ad.websiteUrl || ad.destinationUrl) return "WEBSITE";
  if (ad.contactPhone) return "CALL";
  if (ad.whatsappNumber) return "WHATSAPP";
  if (ad.contactEmail) return "EMAIL";
  if (hasLocation(ad)) return "DIRECTIONS";
  return "CUSTOM_URL";
}

export function assertCtaRequirements(ad: AdvertisementCreativeRow, ctaType: AdvertisementCtaType): void {
  if (ctaType === "CALL" && !ad.contactPhone) {
    throw httpError("Add a phone number for Call Now", 400, "CTA_PHONE_REQUIRED");
  }
  if (ctaType === "WHATSAPP" && !ad.whatsappNumber) {
    throw httpError("Add a WhatsApp number for the WhatsApp action", 400, "CTA_WHATSAPP_REQUIRED");
  }
  if ((ctaType === "WEBSITE") && !(ad.websiteUrl || ad.destinationUrl)) {
    throw httpError("Add a website URL for this call to action", 400, "CTA_WEBSITE_REQUIRED");
  }
  if (ctaType === "EMAIL" && !ad.contactEmail) {
    throw httpError("Add an email address for the Email action", 400, "CTA_EMAIL_REQUIRED");
  }
  if (ctaType === "DIRECTIONS" && !hasLocation(ad)) {
    throw httpError("Add an address or map coordinates for Get Directions", 400, "CTA_LOCATION_REQUIRED");
  }
}

export function assertPublishableCreative(ad: AdvertisementCreativeRow): void {
  if (!ad.title?.trim() || !ad.description?.trim() || !ad.ctaLabel?.trim()) {
    throw httpError("Complete advertisement details before publishing", 400, "INCOMPLETE");
  }
  if (!ad.mediaUrl && !ad.mediaFileId) {
    throw httpError("Upload advertisement media before publishing", 400, "MEDIA_REQUIRED");
  }
  if (!ad.businessName?.trim()) {
    throw httpError("Add a business name before publishing", 400, "BUSINESS_REQUIRED");
  }
  const ctaType = inferLegacyCtaType(ad);
  assertCtaRequirements(ad, ctaType);
}

export function ctaTarget(ad: AdvertisementCreativeRow, ctaType: AdvertisementCtaType): string | null {
  if (ctaType === "CALL" && ad.contactPhone) return ad.contactPhone;
  if (ctaType === "WHATSAPP" && ad.whatsappNumber) return ad.whatsappNumber;
  if (ctaType === "EMAIL" && ad.contactEmail) return ad.contactEmail;
  if (ctaType === "WEBSITE" || ctaType === "CUSTOM_URL") return ad.websiteUrl || ad.destinationUrl;
  if (ctaType === "DIRECTIONS") {
    const lat = ad.latitude == null ? null : Number(ad.latitude);
    const lng = ad.longitude == null ? null : Number(ad.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return `${lat},${lng}`;
    return [ad.address, ad.city, ad.district, ad.state, ad.pincode].filter(Boolean).join(", ") || null;
  }
  return null;
}

export function serializeCreative(ad: AdvertisementCreativeRow) {
  const ctaType = inferLegacyCtaType(ad);
  const lat = ad.latitude == null || ad.latitude === "" ? null : Number(ad.latitude);
  const lng = ad.longitude == null || ad.longitude === "" ? null : Number(ad.longitude);
  const location =
    hasLocation(ad)
      ? {
          address: ad.address,
          city: ad.city,
          district: ad.district,
          state: ad.state,
          pincode: ad.pincode,
          latitude: Number.isFinite(lat) ? lat : null,
          longitude: Number.isFinite(lng) ? lng : null
        }
      : null;
  const target = ctaTarget(ad, ctaType);
  const storedLabel = String(ad.ctaLabel || "").trim();
  const genericLabel = ["learn more", "view details", "view advertisement", "contact us", "tap to view"].includes(
    storedLabel.toLowerCase()
  );
  return {
    type: "ADVERTISEMENT" as const,
    business: {
      name: ad.businessName || ad.title,
      category: ad.businessCategory
    },
    content: {
      title: ad.title,
      shortDescription: ad.shortDescription,
      description: ad.description
    },
    contact: {
      phone: ad.contactPhone,
      whatsapp: ad.whatsappNumber,
      email: ad.contactEmail,
      website: ad.websiteUrl || ad.destinationUrl
    },
    location,
    cta: {
      type: ctaType,
      label: target
        ? !storedLabel || genericLabel
          ? defaultCtaLabel(ctaType)
          : storedLabel
        : storedLabel && !genericLabel
          ? storedLabel
          : "",
      target
    }
  };
}

export function applyNormalizedCreative<T extends Record<string, unknown>>(
  row: T,
  normalized: ReturnType<typeof normalizeCreativeInput>
): void {
  const assign = (key: string, value: unknown) => {
    if (value !== undefined) (row as Record<string, unknown>)[key] = value;
  };
  assign("businessName", normalized.businessName);
  assign("businessCategory", normalized.businessCategory);
  assign("shortDescription", normalized.shortDescription);
  assign("contactPhone", normalized.contactPhone);
  assign("whatsappNumber", normalized.whatsappNumber);
  assign("contactEmail", normalized.contactEmail);
  assign("websiteUrl", normalized.websiteUrl);
  assign("address", normalized.address);
  assign("city", normalized.city);
  assign("district", normalized.district);
  assign("state", normalized.state);
  assign("pincode", normalized.pincode);
  assign("latitude", normalized.latitude);
  assign("longitude", normalized.longitude);
  assign("ctaType", normalized.ctaType);
  if (normalized.ctaLabel) assign("ctaLabel", normalized.ctaLabel);
  if (normalized.destinationUrl !== undefined) assign("destinationUrl", normalized.destinationUrl);
  if (normalized.websiteUrl !== undefined && normalized.destinationUrl === undefined) {
    assign("destinationUrl", normalized.websiteUrl);
  }
  if (normalized.ctaType && !normalized.ctaLabel && !(row as { ctaLabel?: string }).ctaLabel) {
    assign("ctaLabel", defaultCtaLabel(normalized.ctaType));
  }
}
