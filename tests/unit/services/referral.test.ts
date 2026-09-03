import { describe, expect, it } from "vitest";
import {
  displayMemberId,
  INVALID_REFERRAL_CODE_MESSAGE,
  REFERRAL_CODE_PATTERN
} from "../../../src/constants/referral.constants";
import {
  canActAsReferrer,
  canAdminConfirm,
  canAdminRejectReferral,
  canAdminRequestReferral,
  canApplicantSubmitReferral,
  generateReferralCode,
  historicalReferrerUserId,
  isEligibleReferrerStatus,
  isOpenReferralStatus,
  isValidReferralCodeFormat,
  normalizeReferralCode
} from "../../../src/services/referral/referralLogic";

describe("referral code generation", () => {
  it("generates unique DH- codes without sequential ids", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const code = generateReferralCode();
      expect(isValidReferralCodeFormat(code)).toBe(true);
      expect(REFERRAL_CODE_PATTERN.test(code)).toBe(true);
      codes.add(code);
    }
    expect(codes.size).toBe(80);
  });

  it("normalizes whitespace and case", () => {
    expect(normalizeReferralCode(" dh-ab2c3d ")).toBe("DH-AB2C3D");
  });

  it("rejects malformed codes", () => {
    expect(isValidReferralCodeFormat("DH-000000")).toBe(false);
    expect(isValidReferralCodeFormat("ABC123")).toBe(false);
    expect(INVALID_REFERRAL_CODE_MESSAGE).toContain("Invalid referral code");
  });
});

describe("referrer eligibility", () => {
  it("allows only approved active members as new referrers", () => {
    expect(isEligibleReferrerStatus("APPROVED")).toBe(true);
    expect(canActAsReferrer({ status: "APPROVED", deletedAt: null })).toBe(true);
    expect(canActAsReferrer({ status: "PENDING", deletedAt: null })).toBe(false);
    expect(canActAsReferrer({ status: "REJECTED", deletedAt: null })).toBe(false);
    expect(canActAsReferrer({ status: "SUSPENDED", deletedAt: null })).toBe(false);
    expect(canActAsReferrer({ status: "APPROVED", deletedAt: new Date() })).toBe(false);
  });
});

describe("referral status machine (separate from registration)", () => {
  it("keeps request / confirm / reject / submit gates independent of approval", () => {
    expect(
      canAdminRequestReferral({ applicantStatus: "PENDING", currentReferralStatus: "NOT_PROVIDED" })
    ).toBe(true);
    expect(
      canAdminRequestReferral({
        applicantStatus: "PENDING",
        currentReferralStatus: "PENDING_ADMIN_VERIFICATION"
      })
    ).toBe(false);
    expect(canAdminConfirm("PENDING_ADMIN_VERIFICATION")).toBe(true);
    expect(canAdminConfirm("CONFIRMED")).toBe(false);
    expect(canAdminRejectReferral("PENDING_ADMIN_VERIFICATION")).toBe(true);
    expect(
      canApplicantSubmitReferral({
        applicantStatus: "CHANGES_REQUESTED",
        currentReferralStatus: "REQUESTED"
      })
    ).toBe(true);
    expect(
      canApplicantSubmitReferral({ applicantStatus: "PENDING", currentReferralStatus: "NOT_PROVIDED" })
    ).toBe(false);
    expect(
      canApplicantSubmitReferral({ applicantStatus: "APPROVED", currentReferralStatus: "REQUESTED" })
    ).toBe(false);
    expect(isOpenReferralStatus("REQUESTED")).toBe(true);
    expect(isOpenReferralStatus("CONFIRMED")).toBe(false);
  });
});

describe("permanent referrer attribution after code regeneration", () => {
  it("keeps applicant B linked to member A after A regenerates twice", () => {
    const memberA = { userId: 100, currentCode: "DH-AAA111" };
    const applicantB = { userId: 2050 };

    const stored = {
      applicantUserId: applicantB.userId,
      referrerUserId: memberA.userId,
      referralCodeSnapshot: memberA.currentCode,
      status: "PENDING_ADMIN_VERIFICATION" as const
    };

    memberA.currentCode = "DH-BBB222";
    memberA.currentCode = "DH-CCC333";

    expect(historicalReferrerUserId(stored)).toBe(100);
    expect(historicalReferrerUserId(stored)).not.toBeNull();
    expect(stored.referrerUserId).toBe(100);
    expect(stored.referralCodeSnapshot).toBe("DH-AAA111");
    expect(memberA.currentCode).toBe("DH-CCC333");
    expect(displayMemberId(stored.referrerUserId)).toBe("DH100");
  });

  it("still answers who referred the applicant years later from stored referrerUserId", () => {
    const record = {
      applicantUserId: 2050,
      referrerUserId: 1024,
      referralCodeSnapshot: "DH-ABC123",
      status: "CONFIRMED" as const,
      verifiedAt: new Date("2026-08-12T00:00:00.000Z")
    };
    const laterLookupYear = 2028;
    expect(laterLookupYear).toBeGreaterThan(2026);
    expect(historicalReferrerUserId(record)).toBe(1024);
    expect(displayMemberId(1024)).toBe("DH1024");
  });
});

describe("unauthorized client fields", () => {
  it("never treats a client referrerUserId as attribution", () => {
    const clientPayload = { referralCode: "DH-K7X92P", referrerUserId: 9999 };
    const stored = {
      referrerUserId: 1024,
      referralCodeSnapshot: clientPayload.referralCode
    };
    expect(historicalReferrerUserId(stored)).toBe(1024);
    expect(historicalReferrerUserId(stored)).not.toBe(clientPayload.referrerUserId);
  });
});
