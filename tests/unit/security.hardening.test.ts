import { generateOtp } from "../../src/utils/generateOtp";
import { timingSafeEqualHex, timingSafeEqualUtf8 } from "../../src/utils/timingSafe.util";
import { allowDevMatrimonyPayments } from "../../src/services/Razorpay.service";

describe("security hardening", () => {
  test("generateOtp returns 6 digit numeric strings", () => {
    for (let i = 0; i < 40; i++) {
      const otp = generateOtp();
      expect(otp).toMatch(/^\d{6}$/);
      const n = Number(otp);
      expect(n).toBeGreaterThanOrEqual(100000);
      expect(n).toBeLessThanOrEqual(999999);
    }
  });

  test("timingSafeEqualHex matches equal digests", () => {
    const a = "a".repeat(64);
    expect(timingSafeEqualHex(a, a)).toBe(true);
    expect(timingSafeEqualHex(a, "b".repeat(64))).toBe(false);
    expect(timingSafeEqualHex(a, "abc")).toBe(false);
  });

  test("timingSafeEqualUtf8 rejects unequal lengths without throwing", () => {
    expect(timingSafeEqualUtf8("abc", "abcd")).toBe(false);
    expect(timingSafeEqualUtf8("same", "same")).toBe(true);
  });

  test("allowDevMatrimonyPayments is hard-blocked in production", () => {
    const prevNode = process.env.NODE_ENV;
    const prevFlag = process.env.MATRIMONY_ALLOW_DEV_PAYMENTS;
    process.env.NODE_ENV = "production";
    process.env.MATRIMONY_ALLOW_DEV_PAYMENTS = "true";
    expect(allowDevMatrimonyPayments()).toBe(false);
    process.env.NODE_ENV = prevNode;
    if (prevFlag === undefined) delete process.env.MATRIMONY_ALLOW_DEV_PAYMENTS;
    else process.env.MATRIMONY_ALLOW_DEV_PAYMENTS = prevFlag;
  });
});
