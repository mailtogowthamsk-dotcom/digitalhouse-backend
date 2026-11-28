import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Transaction } from "sequelize";
import {
  consumeRegistrationProof,
  sendRegistrationCode,
  verifyRegistrationCode
} from "../../../src/services/registrationEmail.service";
import { hashEmailOtp, sha256Hex } from "../../../src/utils/hash.util";

const mocks = vi.hoisted(() => ({ query: vi.fn(), sendMail: vi.fn(), transaction: {} as Transaction }));
vi.mock("../../../src/config/db", () => ({
  sequelize: {
    query: mocks.query,
    transaction: (callback: (transaction: Transaction) => unknown) => callback(mocks.transaction)
  }
}));
vi.mock("../../../src/services/mail.service", () => ({ sendRegistrationOtpEmail: mocks.sendMail }));

const email = "member@example.com";
const code = "521643";
const challenge = { codeHash: hashEmailOtp(`registration:${email}`, code), codeSecondsLeft: 45, attempts: 0 };

describe("Registration email verification", () => {
  beforeEach(() => vi.resetAllMocks());

  it("stores a purpose-separated OTP hash and sends to the normalized address", async () => {
    mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ resendSecondsLeft: 0 }]).mockResolvedValueOnce([]);
    await expect(sendRegistrationCode(" Member@Example.com ")).resolves.toEqual({ sent: true, retryAfterSeconds: 60 });
    const delivered = mocks.sendMail.mock.calls[0][1];
    expect(delivered).toMatch(/^\d{6}$/);
    expect(mocks.sendMail).toHaveBeenCalledWith(email, delivered, 10);
    expect(mocks.query.mock.calls[2][1]).toMatchObject({
      replacements: { email, hash: hashEmailOtp(`registration:${email}`, delivered) },
      transaction: mocks.transaction
    });
  });

  it("does not send a second email during the cooldown", async () => {
    mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ resendSecondsLeft: "15.250" }]);
    await expect(sendRegistrationCode(email)).resolves.toEqual({ sent: false, retryAfterSeconds: 16 });
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("does not issue a proof after the attempt limit or expiry", async () => {
    mocks.query.mockResolvedValueOnce([{ ...challenge, attempts: 5 }]);
    await expect(verifyRegistrationCode(email, code)).resolves.toMatchObject({ error: expect.stringMatching(/attempt/) });
    mocks.query.mockResolvedValueOnce([{ ...challenge, codeSecondsLeft: 0 }]);
    await expect(verifyRegistrationCode(email, code)).resolves.toMatchObject({ error: expect.stringMatching(/expired/) });
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it("counts a failed attempt even when returning an invalid-code result", async () => {
    mocks.query.mockResolvedValueOnce([{ ...challenge, attempts: 4 }]).mockResolvedValueOnce([]);
    await expect(verifyRegistrationCode(email, "000000")).resolves.toMatchObject({ error: expect.stringMatching(/attempt/) });
    expect(mocks.query.mock.calls[1][0]).toMatch(/attempts = attempts \+ 1/);
  });

  it("returns a proof, saves only its hash, and requires an atomic consume", async () => {
    mocks.query.mockResolvedValueOnce([challenge]).mockResolvedValueOnce([]);
    const { proof } = await verifyRegistrationCode(email, code);
    expect(proof).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.query.mock.calls[1][0]).toMatch(/code_hash = NULL/);
    expect(mocks.query.mock.calls[1][1]).toMatchObject({ replacements: { email, proofHash: sha256Hex(proof!) } });

    mocks.query.mockResolvedValueOnce([undefined, 1]).mockResolvedValueOnce([undefined, 0]);
    await expect(consumeRegistrationProof(email, proof, mocks.transaction)).resolves.toBeUndefined();
    const [consumeSql, consumeOptions] = mocks.query.mock.calls[2];
    expect(consumeSql).toMatch(/WHERE email = :email AND proof_hash = :proofHash AND proof_expires_at > NOW/);
    expect(consumeOptions).toMatchObject({ replacements: { email }, transaction: mocks.transaction });
    await expect(consumeRegistrationProof(email, proof, mocks.transaction))
      .rejects.toMatchObject({ code: "REGISTRATION_EMAIL_VERIFICATION_REQUIRED" });
  });
});
