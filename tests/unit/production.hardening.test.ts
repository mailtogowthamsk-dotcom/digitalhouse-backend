import { detectMediaMimeFromBytes, isExecutableOrScriptMagic } from "../../src/utils/mediaMagic.util";
import { generateOtp } from "../../src/utils/generateOtp";
import { allowDevMatrimonyPayments } from "../../src/services/Razorpay.service";
import { revokeUserTokens, isAccessTokenActive } from "../../src/utils/tokenRevocation";

describe("final production hardening", () => {
  test("magic bytes detect jpeg/png/webp/mp4", () => {
    expect(detectMediaMimeFromBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(
      detectMediaMimeFromBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))
    ).toBe("image/png");
    const webp = Buffer.alloc(12);
    webp.write("RIFF", 0);
    webp.write("WEBP", 8);
    expect(detectMediaMimeFromBytes(webp)).toBe("image/webp");
    const mp4 = Buffer.alloc(12);
    mp4.write("....", 0);
    mp4.write("ftyp", 4);
    mp4.write("isom", 8);
    expect(detectMediaMimeFromBytes(mp4)).toBe("video/mp4");
  });

  test("rejects executable magic", () => {
    expect(isExecutableOrScriptMagic(Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).toBe(true);
    expect(isExecutableOrScriptMagic(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false);
  });

  test("OTP still 6 digits", () => {
    expect(generateOtp()).toMatch(/^\d{6}$/);
  });

  test("dev payments blocked in production", () => {
    const prevNode = process.env.NODE_ENV;
    const prevFlag = process.env.MATRIMONY_ALLOW_DEV_PAYMENTS;
    process.env.NODE_ENV = "production";
    process.env.MATRIMONY_ALLOW_DEV_PAYMENTS = "true";
    expect(allowDevMatrimonyPayments()).toBe(false);
    process.env.NODE_ENV = prevNode;
    if (prevFlag === undefined) delete process.env.MATRIMONY_ALLOW_DEV_PAYMENTS;
    else process.env.MATRIMONY_ALLOW_DEV_PAYMENTS = prevFlag;
  });

  test("token revocation rejects older iat", async () => {
    const userId = 424242;
    const now = Math.floor(Date.now() / 1000);
    await revokeUserTokens(userId, "test");
    expect(await isAccessTokenActive(userId, now - 10)).toBe(false);
    expect(await isAccessTokenActive(userId, now + 5)).toBe(true);
  });
});
