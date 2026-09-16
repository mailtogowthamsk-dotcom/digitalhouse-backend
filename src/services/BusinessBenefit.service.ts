/**
 * Member Benefits — create/manage/claim/verify for Digital House businesses.
 * Does not create Connections or touch Matrimony.
 */

import { randomBytes } from "crypto";
import { Op, Transaction, UniqueConstraintError } from "sequelize";
import { sequelize } from "../config/db";
import { BusinessBenefit, BusinessBenefitClaim, User, UserProfile } from "../models";
import {
  BENEFIT_CLAIM_CODE_ALPHABET,
  BENEFIT_DESCRIPTION_MAX,
  BENEFIT_TERMS_MAX,
  BENEFIT_TITLE_MAX,
  BENEFIT_VALUE_MAX,
  BUSINESS_BENEFIT_TYPES,
  type BusinessBenefitClaimStatus,
  type BusinessBenefitStatus,
  type BusinessBenefitType
} from "../constants/businessBenefit.constants";
import { toPublicBusinessProfile } from "./Profile.service";
import { getBlockedUserIds } from "./MatrimonySafety.service";
import * as Notifications from "./Notification.service";

function httpErr(message: string, status: number, code?: string): Error {
  return Object.assign(new Error(message), { status, code });
}

function trimRequired(v: unknown, field: string, max: number): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) throw httpErr(`${field} is required.`, 400, "VALIDATION");
  if (s.length > max) throw httpErr(`${field} must be at most ${max} characters.`, 400, "VALIDATION");
  return s;
}

function parseOptionalDate(v: unknown, field: string, opts?: { endOfDay?: boolean }): Date | null {
  if (v == null || v === "") return null;
  const raw = String(v).trim();
  // Date-only (YYYY-MM-DD): treat validFrom as start-of-day UTC, validUntil as end-of-day UTC
  // so a benefit "valid until 30 Sep" remains usable for the whole calendar day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T${opts?.endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
    if (Number.isNaN(d.getTime())) throw httpErr(`Invalid ${field}.`, 400, "VALIDATION");
    return d;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw httpErr(`Invalid ${field}.`, 400, "VALIDATION");
  return d;
}

function parseUsageLimit(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw httpErr("Usage limit must be a positive whole number.", 400, "VALIDATION");
  }
  if (n > 1_000_000) throw httpErr("Usage limit is too large.", 400, "VALIDATION");
  return n;
}

function parseBenefitType(v: unknown): BusinessBenefitType {
  const t = String(v || "").trim().toUpperCase();
  if (!(BUSINESS_BENEFIT_TYPES as readonly string[]).includes(t)) {
    throw httpErr("Please select a valid benefit type.", 400, "VALIDATION");
  }
  return t as BusinessBenefitType;
}

async function assertOwnerHasActiveBusiness(ownerId: number): Promise<{
  businessName: string;
}> {
  const [user, profile] = await Promise.all([
    User.findByPk(ownerId, { attributes: ["id", "status", "fullName"] }),
    UserProfile.findOne({ where: { userId: ownerId }, attributes: ["business"] })
  ]);
  if (!user || user.status !== "APPROVED") {
    throw httpErr("Business Profile is not available.", 400, "BUSINESS_UNAVAILABLE");
  }
  const pub = toPublicBusinessProfile(profile?.business ?? null);
  if (!pub) {
    throw httpErr(
      "An approved and active Business Profile is required to manage Member Benefits.",
      400,
      "BUSINESS_INACTIVE"
    );
  }
  return { businessName: pub.businessName || user.fullName || "Business" };
}

function isWithinValidity(benefit: BusinessBenefit, now = new Date()): boolean {
  if (benefit.validFrom && benefit.validFrom.getTime() > now.getTime()) return false;
  if (benefit.validUntil && benefit.validUntil.getTime() < now.getTime()) return false;
  return true;
}

function effectiveStatus(benefit: BusinessBenefit, now = new Date()): BusinessBenefitStatus {
  if (benefit.status === "ACTIVE" && benefit.validUntil && benefit.validUntil.getTime() < now.getTime()) {
    return "EXPIRED";
  }
  return benefit.status;
}

function remainingClaims(benefit: BusinessBenefit): number | null {
  if (benefit.usageLimit == null) return null;
  return Math.max(0, benefit.usageLimit - Number(benefit.claimCount || 0));
}

export type OwnerBenefitDto = {
  id: number;
  title: string;
  description: string;
  benefitType: string;
  value: string;
  validFrom: string | null;
  validUntil: string | null;
  terms: string | null;
  usageLimit: number | null;
  claimCount: number;
  remainingClaims: number | null;
  status: BusinessBenefitStatus;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicBenefitDto = {
  id: number;
  businessOwnerId: number;
  businessName: string;
  title: string;
  description: string;
  benefitType: string;
  value: string;
  validFrom: string | null;
  validUntil: string | null;
  terms: string | null;
  remainingClaims: number | null;
  myClaim: ClaimDto | null;
};

export type ClaimDto = {
  id: number;
  benefitId: number;
  claimCode: string;
  status: BusinessBenefitClaimStatus;
  claimedAt: string;
  usedAt: string | null;
  expiresAt: string | null;
  benefitTitle?: string;
  benefitValue?: string;
  businessName?: string;
  memberName?: string;
  terms?: string | null;
  validUntil?: string | null;
  /** False when the owner's Business Profile is no longer public/active. */
  businessAvailable?: boolean;
};

function toOwnerDto(b: BusinessBenefit): OwnerBenefitDto {
  const status = effectiveStatus(b);
  return {
    id: b.id,
    title: b.title,
    description: b.description,
    benefitType: b.benefitType,
    value: b.value,
    validFrom: b.validFrom ? b.validFrom.toISOString() : null,
    validUntil: b.validUntil ? b.validUntil.toISOString() : null,
    terms: b.terms,
    usageLimit: b.usageLimit,
    claimCount: Number(b.claimCount || 0),
    remainingClaims: remainingClaims(b),
    status,
    adminNote: status === "REJECTED" ? b.adminNote : null,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString()
  };
}

function toClaimDto(
  c: BusinessBenefitClaim,
  extras?: {
    benefitTitle?: string;
    benefitValue?: string;
    businessName?: string;
    memberName?: string;
    terms?: string | null;
    validUntil?: string | null;
    businessAvailable?: boolean;
  }
): ClaimDto {
  return {
    id: c.id,
    benefitId: c.benefitId,
    claimCode: c.claimCode,
    status: c.status,
    claimedAt: c.claimedAt.toISOString(),
    usedAt: c.usedAt ? c.usedAt.toISOString() : null,
    expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
    benefitTitle: extras?.benefitTitle,
    benefitValue: extras?.benefitValue,
    businessName: extras?.businessName,
    memberName: extras?.memberName,
    terms: extras?.terms ?? undefined,
    validUntil: extras?.validUntil ?? undefined,
    businessAvailable: extras?.businessAvailable
  };
}

function generateClaimCode(): string {
  const alphabet = BENEFIT_CLAIM_CODE_ALPHABET;
  const pick = (n: number) => {
    const bytes = randomBytes(n);
    let out = "";
    for (let i = 0; i < n; i++) out += alphabet[bytes[i]! % alphabet.length];
    return out;
  };
  return `DH-${pick(4)}-${pick(2)}`;
}

async function allocateUniqueClaimCode(tx: Transaction): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = generateClaimCode();
    const existing = await BusinessBenefitClaim.findOne({
      where: { claimCode: code },
      attributes: ["id"],
      transaction: tx,
      lock: tx.LOCK.UPDATE
    });
    if (!existing) return code;
  }
  throw httpErr("Could not generate a claim code. Please try again.", 500, "CODE_GEN");
}

function normalizeBenefitInput(input: Record<string, unknown>) {
  const title = trimRequired(input.title, "Title", BENEFIT_TITLE_MAX);
  const description = trimRequired(input.description, "Description", BENEFIT_DESCRIPTION_MAX);
  const benefitType = parseBenefitType(input.benefitType);
  const value = trimRequired(input.value, "Value", BENEFIT_VALUE_MAX);
  const termsRaw = typeof input.terms === "string" ? input.terms.trim() : "";
  if (termsRaw.length > BENEFIT_TERMS_MAX) {
    throw httpErr(`Terms must be at most ${BENEFIT_TERMS_MAX} characters.`, 400, "VALIDATION");
  }
  const validFrom = parseOptionalDate(input.validFrom, "valid from");
  const validUntil = parseOptionalDate(input.validUntil, "valid until", { endOfDay: true });
  if (validFrom && validUntil && validUntil.getTime() < validFrom.getTime()) {
    throw httpErr("Valid until must be on or after valid from.", 400, "VALIDATION");
  }
  const usageLimit = parseUsageLimit(input.usageLimit);
  return {
    title,
    description,
    benefitType,
    value,
    terms: termsRaw || null,
    validFrom,
    validUntil,
    usageLimit
  };
}

/** POST /api/business/benefits */
export async function createBenefit(ownerId: number, input: Record<string, unknown>) {
  await assertOwnerHasActiveBusiness(ownerId);
  const data = normalizeBenefitInput(input);
  const row = await BusinessBenefit.create({
    businessOwnerId: ownerId,
    ...data,
    claimCount: 0,
    status: "PENDING",
    adminNote: null,
    reviewedAt: null,
    reviewedByAdmin: null
  } as any);
  return toOwnerDto(row);
}

/** GET /api/business/benefits/mine */
export async function listMyBenefits(ownerId: number): Promise<OwnerBenefitDto[]> {
  const rows = await BusinessBenefit.findAll({
    where: { businessOwnerId: ownerId },
    order: [["updatedAt", "DESC"]]
  });
  return rows.map(toOwnerDto);
}

/** GET owner benefit by id */
export async function getMyBenefit(ownerId: number, benefitId: number): Promise<OwnerBenefitDto> {
  const row = await BusinessBenefit.findByPk(benefitId);
  if (!row || row.businessOwnerId !== ownerId) {
    throw httpErr("Benefit not found.", 404, "NOT_FOUND");
  }
  return toOwnerDto(row);
}

/**
 * PUT — owner edit.
 * Any edit resubmits for approval (PENDING). Public ACTIVE copy is withdrawn until re-approved.
 */
export async function updateBenefit(
  ownerId: number,
  benefitId: number,
  input: Record<string, unknown>
): Promise<OwnerBenefitDto> {
  await assertOwnerHasActiveBusiness(ownerId);
  const row = await BusinessBenefit.findByPk(benefitId);
  if (!row || row.businessOwnerId !== ownerId) {
    throw httpErr("Benefit not found.", 404, "NOT_FOUND");
  }
  if (row.status === "DISABLED") {
    throw httpErr("Disabled benefits cannot be edited. Create a new benefit instead.", 400, "DISABLED");
  }
  const data = normalizeBenefitInput(input);
  await row.update({
    ...data,
    status: "PENDING",
    adminNote: null,
    reviewedAt: null,
    reviewedByAdmin: null
  } as any);
  return toOwnerDto(row);
}

/** PATCH disable */
export async function disableBenefit(ownerId: number, benefitId: number): Promise<OwnerBenefitDto> {
  const row = await BusinessBenefit.findByPk(benefitId);
  if (!row || row.businessOwnerId !== ownerId) {
    throw httpErr("Benefit not found.", 404, "NOT_FOUND");
  }
  if (row.status !== "ACTIVE" && effectiveStatus(row) !== "EXPIRED") {
    throw httpErr("Only active benefits can be disabled.", 400, "INVALID_STATUS");
  }
  await row.update({ status: "DISABLED" } as any);
  return toOwnerDto(row);
}

async function loadPublicBusinessName(ownerId: number): Promise<string | null> {
  const [user, profile] = await Promise.all([
    User.findByPk(ownerId, { attributes: ["id", "status", "fullName"] }),
    UserProfile.findOne({ where: { userId: ownerId }, attributes: ["business"] })
  ]);
  if (!user || user.status !== "APPROVED") return null;
  const pub = toPublicBusinessProfile(profile?.business ?? null);
  if (!pub) return null;
  return pub.businessName || user.fullName || "Business";
}

function publicBenefitWhere(now: Date) {
  return {
    status: "ACTIVE" as const,
    [Op.and]: [
      { [Op.or]: [{ validFrom: null }, { validFrom: { [Op.lte]: now } }] },
      { [Op.or]: [{ validUntil: null }, { validUntil: { [Op.gte]: now } }] }
    ]
  };
}

/** GET public benefits for a business owner (member profile surface). */
export async function listPublicBenefitsForOwner(
  viewerId: number,
  businessOwnerId: number
): Promise<PublicBenefitDto[]> {
  const businessName = await loadPublicBusinessName(businessOwnerId);
  if (!businessName) return [];

  const now = new Date();
  const rows = await BusinessBenefit.findAll({
    where: {
      businessOwnerId,
      ...publicBenefitWhere(now)
    },
    order: [["updatedAt", "DESC"]]
  });

  const claims =
    viewerId > 0
      ? await BusinessBenefitClaim.findAll({
          where: {
            memberId: viewerId,
            benefitId: { [Op.in]: rows.map((r) => r.id) }
          }
        })
      : [];
  const claimByBenefit = new Map(claims.map((c) => [c.benefitId, c]));

  return rows
    .filter((b) => {
      const rem = remainingClaims(b);
      return rem == null || rem > 0;
    })
    .map((b) => {
      const mine = claimByBenefit.get(b.id) ?? null;
      return {
        id: b.id,
        businessOwnerId: b.businessOwnerId,
        businessName,
        title: b.title,
        description: b.description,
        benefitType: b.benefitType,
        value: b.value,
        validFrom: b.validFrom ? b.validFrom.toISOString() : null,
        validUntil: b.validUntil ? b.validUntil.toISOString() : null,
        terms: b.terms,
        remainingClaims: remainingClaims(b),
        myClaim: mine ? toClaimDto(mine) : null
      };
    });
}

/** GET /api/business/benefits/available — lightweight feed of active benefits (no directory search). */
export async function listAvailableBenefits(viewerId: number, limit = 40): Promise<PublicBenefitDto[]> {
  const now = new Date();
  const capped = Math.min(Math.max(Number(limit) || 40, 1), 80);
  const rows = await BusinessBenefit.findAll({
    where: publicBenefitWhere(now),
    order: [["updatedAt", "DESC"]],
    limit: capped * 2 // filter inactive businesses after
  });

  const ownerIds = [...new Set(rows.map((r) => r.businessOwnerId))];
  const nameByOwner = new Map<number, string>();
  await Promise.all(
    ownerIds.map(async (oid) => {
      const name = await loadPublicBusinessName(oid);
      if (name) nameByOwner.set(oid, name);
    })
  );

  const claims = await BusinessBenefitClaim.findAll({
    where: {
      memberId: viewerId,
      benefitId: { [Op.in]: rows.map((r) => r.id) }
    }
  });
  const claimByBenefit = new Map(claims.map((c) => [c.benefitId, c]));

  const out: PublicBenefitDto[] = [];
  for (const b of rows) {
    const businessName = nameByOwner.get(b.businessOwnerId);
    if (!businessName) continue;
    const rem = remainingClaims(b);
    if (rem != null && rem <= 0) continue;
    const mine = claimByBenefit.get(b.id) ?? null;
    out.push({
      id: b.id,
      businessOwnerId: b.businessOwnerId,
      businessName,
      title: b.title,
      description: b.description,
      benefitType: b.benefitType,
      value: b.value,
      validFrom: b.validFrom ? b.validFrom.toISOString() : null,
      validUntil: b.validUntil ? b.validUntil.toISOString() : null,
      terms: b.terms,
      remainingClaims: rem,
      myClaim: mine ? toClaimDto(mine) : null
    });
    if (out.length >= capped) break;
  }
  return out;
}

/** GET public benefit detail */
export async function getPublicBenefit(
  viewerId: number,
  benefitId: number
): Promise<PublicBenefitDto> {
  const row = await BusinessBenefit.findByPk(benefitId);
  if (!row || row.status !== "ACTIVE" || !isWithinValidity(row)) {
    throw httpErr("This benefit is not available.", 404, "NOT_AVAILABLE");
  }
  const rem = remainingClaims(row);
  if (rem != null && rem <= 0) {
    throw httpErr("This benefit is no longer available.", 400, "USAGE_LIMIT");
  }
  const businessName = await loadPublicBusinessName(row.businessOwnerId);
  if (!businessName) {
    throw httpErr("This Business Profile is currently unavailable.", 400, "BUSINESS_UNAVAILABLE");
  }
  const mine =
    viewerId > 0
      ? await BusinessBenefitClaim.findOne({
          where: { benefitId: row.id, memberId: viewerId }
        })
      : null;
  return {
    id: row.id,
    businessOwnerId: row.businessOwnerId,
    businessName,
    title: row.title,
    description: row.description,
    benefitType: row.benefitType,
    value: row.value,
    validFrom: row.validFrom ? row.validFrom.toISOString() : null,
    validUntil: row.validUntil ? row.validUntil.toISOString() : null,
    terms: row.terms,
    remainingClaims: rem,
    myClaim: mine ? toClaimDto(mine) : null
  };
}

/** POST claim */
export async function claimBenefit(memberId: number, benefitId: number): Promise<ClaimDto> {
  if (!memberId || memberId < 1) throw httpErr("Unauthorized", 401, "UNAUTHORIZED");

  const member = await User.findByPk(memberId, { attributes: ["id", "status", "fullName"] });
  if (!member || member.status !== "APPROVED") throw httpErr("Unauthorized", 401, "UNAUTHORIZED");

  try {
    const result = await sequelize.transaction(async (tx) => {
      const benefit = await BusinessBenefit.findByPk(benefitId, {
        transaction: tx,
        lock: tx.LOCK.UPDATE
      });
      if (!benefit) throw httpErr("Benefit not found.", 404, "NOT_FOUND");
      if (benefit.businessOwnerId === memberId) {
        throw httpErr("You cannot claim your own business benefit.", 400, "SELF_CLAIM");
      }
      if (benefit.status !== "ACTIVE") {
        throw httpErr("This benefit is not available.", 400, "NOT_AVAILABLE");
      }
      if (!isWithinValidity(benefit)) {
        throw httpErr("This benefit is not currently valid.", 400, "NOT_VALID");
      }

      const businessName = await loadPublicBusinessName(benefit.businessOwnerId);
      if (!businessName) {
        throw httpErr("This Business Profile is currently unavailable.", 400, "BUSINESS_UNAVAILABLE");
      }

      const blocked = await getBlockedUserIds(memberId);
      if (blocked.has(benefit.businessOwnerId)) {
        throw httpErr("You cannot claim this benefit.", 403, "BLOCKED");
      }
      const blockedByOwner = await getBlockedUserIds(benefit.businessOwnerId);
      if (blockedByOwner.has(memberId)) {
        throw httpErr("You cannot claim this benefit.", 403, "BLOCKED");
      }

      const existing = await BusinessBenefitClaim.findOne({
        where: { benefitId: benefit.id, memberId },
        transaction: tx,
        lock: tx.LOCK.UPDATE
      });
      if (existing) {
        throw httpErr("You have already claimed this benefit.", 400, "ALREADY_CLAIMED");
      }

      if (benefit.usageLimit != null && Number(benefit.claimCount) >= benefit.usageLimit) {
        throw httpErr("This benefit has reached its usage limit.", 400, "USAGE_LIMIT");
      }

      const claimCode = await allocateUniqueClaimCode(tx);
      const now = new Date();
      const claim = await BusinessBenefitClaim.create(
        {
          benefitId: benefit.id,
          businessOwnerId: benefit.businessOwnerId,
          memberId,
          claimCode,
          status: "CLAIMED",
          claimedAt: now,
          usedAt: null,
          expiresAt: benefit.validUntil
        } as any,
        { transaction: tx }
      );

      // Atomic increment guarded by usageLimit to prevent race past N.
      if (benefit.usageLimit != null) {
        const [affected] = await BusinessBenefit.update(
          { claimCount: sequelize.literal("claimCount + 1") } as any,
          {
            where: {
              id: benefit.id,
              claimCount: { [Op.lt]: benefit.usageLimit }
            },
            transaction: tx
          }
        );
        if (!affected) {
          throw httpErr("This benefit has reached its usage limit.", 400, "USAGE_LIMIT");
        }
      } else {
        await benefit.update(
          { claimCount: Number(benefit.claimCount || 0) + 1 } as any,
          { transaction: tx }
        );
      }

      return { claim, benefit, businessName };
    });

    void Notifications.notifyBusinessBenefitClaimed(
      result.benefit.businessOwnerId,
      result.benefit.id,
      result.benefit.title,
      member.fullName?.trim() || "A member"
    ).catch(() => {});

    return toClaimDto(result.claim, {
      benefitTitle: result.benefit.title,
      benefitValue: result.benefit.value,
      businessName: result.businessName,
      terms: result.benefit.terms,
      validUntil: result.benefit.validUntil ? result.benefit.validUntil.toISOString() : null
    });
  } catch (e: any) {
    if (e instanceof UniqueConstraintError) {
      throw httpErr("You have already claimed this benefit.", 400, "ALREADY_CLAIMED");
    }
    throw e;
  }
}

/** GET my claims */
export async function listMyClaims(memberId: number): Promise<ClaimDto[]> {
  const rows = await BusinessBenefitClaim.findAll({
    where: { memberId },
    include: [{ model: BusinessBenefit, as: "Benefit", required: false }],
    order: [["claimedAt", "DESC"]]
  });

  const ownerIds = [...new Set(rows.map((r) => r.businessOwnerId))];
  const names = new Map<number, string>();
  const available = new Map<number, boolean>();
  await Promise.all(
    ownerIds.map(async (oid) => {
      const n = await loadPublicBusinessName(oid);
      available.set(oid, n != null);
      names.set(oid, n || "Business");
    })
  );

  return rows.map((c) => {
    const b = (c as any).Benefit as BusinessBenefit | undefined;
    return toClaimDto(c, {
      benefitTitle: b?.title,
      benefitValue: b?.value,
      businessName: names.get(c.businessOwnerId),
      terms: b?.terms ?? null,
      validUntil: b?.validUntil ? b.validUntil.toISOString() : null,
      businessAvailable: available.get(c.businessOwnerId) === true
    });
  });
}

/** GET single claim for member or owner */
export async function getClaimForUser(userId: number, claimId: number): Promise<ClaimDto> {
  const claim = await BusinessBenefitClaim.findByPk(claimId, {
    include: [{ model: BusinessBenefit, as: "Benefit", required: false }]
  });
  if (!claim) throw httpErr("Claim not found.", 404, "NOT_FOUND");
  if (claim.memberId !== userId && claim.businessOwnerId !== userId) {
    throw httpErr("Claim not found.", 404, "NOT_FOUND");
  }
  const benefit = (claim as any).Benefit as BusinessBenefit | undefined;
  const publicName = await loadPublicBusinessName(claim.businessOwnerId);
  return toClaimDto(claim, {
    benefitTitle: benefit?.title,
    benefitValue: benefit?.value,
    businessName: publicName || "Business",
    terms: benefit?.terms ?? null,
    validUntil: benefit?.validUntil ? benefit.validUntil.toISOString() : null,
    businessAvailable: publicName != null
  });
}

/**
 * Owner lookup — does NOT mark used.
 * Returns claim + benefit preview for confirmation UI.
 */
export async function lookupClaimByCode(
  ownerId: number,
  claimCodeRaw: string
): Promise<ClaimDto> {
  await assertOwnerHasActiveBusiness(ownerId);
  const claimCode = String(claimCodeRaw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!claimCode) throw httpErr("Enter a claim code.", 400, "VALIDATION");

  const claim = await BusinessBenefitClaim.findOne({ where: { claimCode } });
  if (!claim || claim.businessOwnerId !== ownerId) {
    throw httpErr("Invalid claim code.", 404, "INVALID_CODE");
  }

  if (claim.status === "EXPIRED" || (claim.expiresAt && claim.expiresAt.getTime() < Date.now())) {
    if (claim.status !== "EXPIRED") {
      await claim.update({ status: "EXPIRED" } as any);
    }
    throw httpErr("This claim has expired.", 400, "EXPIRED");
  }

  const benefit = await BusinessBenefit.findByPk(claim.benefitId);
  if (!benefit || benefit.businessOwnerId !== ownerId) {
    throw httpErr("Invalid claim code.", 404, "INVALID_CODE");
  }

  const member = await User.findByPk(claim.memberId, { attributes: ["fullName"] });
  const businessName = (await loadPublicBusinessName(ownerId)) || "Business";

  return toClaimDto(claim, {
    benefitTitle: benefit.title,
    benefitValue: benefit.value,
    businessName,
    memberName: member?.fullName?.trim() || "Member",
    terms: benefit.terms,
    validUntil: benefit.validUntil ? benefit.validUntil.toISOString() : null
  });
}

/**
 * Owner explicitly marks a previously looked-up claim as USED.
 * Re-validates ownership and claim state.
 */
export async function markClaimUsed(
  ownerId: number,
  claimCodeRaw: string
): Promise<ClaimDto> {
  await assertOwnerHasActiveBusiness(ownerId);
  const claimCode = String(claimCodeRaw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!claimCode) throw httpErr("Enter a claim code.", 400, "VALIDATION");

  const result = await sequelize.transaction(async (tx) => {
    const claim = await BusinessBenefitClaim.findOne({
      where: { claimCode },
      transaction: tx,
      lock: tx.LOCK.UPDATE
    });
    if (!claim || claim.businessOwnerId !== ownerId) {
      throw httpErr("Invalid claim code.", 404, "INVALID_CODE");
    }
    if (claim.status === "USED") {
      throw httpErr("This claim code has already been used.", 400, "ALREADY_USED");
    }
    if (claim.status === "CANCELLED") {
      throw httpErr("This claim was cancelled.", 400, "CANCELLED");
    }
    if (claim.status === "EXPIRED" || (claim.expiresAt && claim.expiresAt.getTime() < Date.now())) {
      if (claim.status !== "EXPIRED") {
        await claim.update({ status: "EXPIRED" } as any, { transaction: tx });
      }
      throw httpErr("This claim has expired.", 400, "EXPIRED");
    }
    if (claim.status !== "CLAIMED") {
      throw httpErr("This claim cannot be marked as used.", 400, "INVALID_STATUS");
    }

    const benefit = await BusinessBenefit.findByPk(claim.benefitId, {
      transaction: tx,
      lock: tx.LOCK.UPDATE
    });
    if (!benefit || benefit.businessOwnerId !== ownerId) {
      throw httpErr("Invalid claim code.", 404, "INVALID_CODE");
    }

    const now = new Date();
    await claim.update({ status: "USED", usedAt: now } as any, { transaction: tx });

    const member = await User.findByPk(claim.memberId, {
      attributes: ["fullName"],
      transaction: tx
    });
    return {
      claim,
      benefit,
      memberName: member?.fullName?.trim() || "Member"
    };
  });

  const businessName = (await loadPublicBusinessName(ownerId)) || "Business";
  return toClaimDto(result.claim, {
    benefitTitle: result.benefit.title,
    benefitValue: result.benefit.value,
    businessName,
    memberName: result.memberName,
    terms: result.benefit.terms,
    validUntil: result.benefit.validUntil ? result.benefit.validUntil.toISOString() : null
  });
}

/** @deprecated — use lookupClaimByCode (preview) + markClaimUsed. */
export async function verifyClaimByCode(
  ownerId: number,
  claimCodeRaw: string
): Promise<ClaimDto> {
  return lookupClaimByCode(ownerId, claimCodeRaw);
}

/** Admin helpers */
export async function adminListPending(page = 1, limit = 25, q?: string) {
  const offset = (Math.max(page, 1) - 1) * limit;
  const where: any = { status: "PENDING" };
  if (q?.trim()) {
    where[Op.or] = [
      { title: { [Op.like]: `%${q.trim()}%` } },
      { value: { [Op.like]: `%${q.trim()}%` } }
    ];
  }
  const { rows, count } = await BusinessBenefit.findAndCountAll({
    where,
    include: [
      {
        model: User,
        as: "BusinessOwner",
        attributes: ["id", "fullName", "email", "username"]
      }
    ],
    order: [["createdAt", "ASC"]],
    limit,
    offset
  });

  const items = await Promise.all(
    rows.map(async (b) => {
      const owner = (b as any).BusinessOwner as User | undefined;
      const businessName = (await loadPublicBusinessName(b.businessOwnerId)) || owner?.fullName || "—";
      return {
        ...toOwnerDto(b),
        businessOwner: owner
          ? {
              id: owner.id,
              fullName: owner.fullName,
              email: owner.email,
              username: (owner as any).username ?? null
            }
          : null,
        businessName
      };
    })
  );

  return { items, total: count, page, limit };
}

export async function adminApproveBenefit(benefitId: number, adminEmail?: string | null) {
  const row = await BusinessBenefit.findByPk(benefitId);
  if (!row) throw httpErr("Benefit not found.", 404, "NOT_FOUND");
  if (row.status === "ACTIVE") return toOwnerDto(row);
  if (row.status !== "PENDING") {
    throw httpErr("Only pending benefits can be approved.", 400, "INVALID_STATUS");
  }
  // Owner must still have active business
  await assertOwnerHasActiveBusiness(row.businessOwnerId);
  await row.update({
    status: "ACTIVE",
    adminNote: null,
    reviewedAt: new Date(),
    reviewedByAdmin: adminEmail?.slice(0, 191) || null
  } as any);

  void Notifications.notifyBusinessBenefitApproved(row.businessOwnerId, row.id, row.title).catch(
    () => {}
  );
  return toOwnerDto(row);
}

export async function adminRejectBenefit(
  benefitId: number,
  reason: string,
  adminEmail?: string | null
) {
  const note = reason.trim();
  if (note.length < 3) {
    throw httpErr("Rejection remarks must be at least 3 characters.", 400, "VALIDATION");
  }
  const row = await BusinessBenefit.findByPk(benefitId);
  if (!row) throw httpErr("Benefit not found.", 404, "NOT_FOUND");
  if (row.status !== "PENDING") {
    throw httpErr("Only pending benefits can be rejected.", 400, "INVALID_STATUS");
  }
  await row.update({
    status: "REJECTED",
    adminNote: note.slice(0, 1000),
    reviewedAt: new Date(),
    reviewedByAdmin: adminEmail?.slice(0, 191) || null
  } as any);

  void Notifications.notifyBusinessBenefitRejected(
    row.businessOwnerId,
    row.id,
    row.title,
    note
  ).catch(() => {});
  return toOwnerDto(row);
}
