import { beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "../../../src/services/user.service";

const mocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateProfile: vi.fn(),
  consumeProof: vi.fn(),
  transaction: {}
}));

vi.mock("../../../src/config/db", () => ({
  sequelize: { transaction: (callback: (transaction: object) => unknown) => callback(mocks.transaction) }
}));
vi.mock("../../../src/services/registrationEmail.service", () => ({
  consumeRegistrationProof: mocks.consumeProof
}));
vi.mock("../../../src/models", () => ({ User: mocks }));
vi.mock("../../../src/services/Username.service", () => ({
  usernameService: {
    normalizeUsername: (username: string) => username,
    validateUsernameFormat: vi.fn(),
    isUsernameAvailable: async () => true
  }
}));
vi.mock("../../../src/services/kulamValidation.service", () => ({
  assertValidKulam: async (kulam: string) => kulam
}));
vi.mock("../../../src/services/ensureUserProfile", () => ({
  ensureUserProfile: async () => ({ update: mocks.updateProfile })
}));
vi.mock("../../../src/services/registrationDesk/RegistrationNotify.service", () => ({
  enqueueRegistrationReceived: vi.fn()
}));
vi.mock("../../../src/utils/r2Client", () => ({
  toStorageKeyIfR2: (photo: string) => photo
}));

const input = {
  fullName: "Test User",
  username: "testuser",
  email: "test@gmail.com",
  mobile: "9876543210",
  fatherName: "Rajan",
  address: "12 Main Street",
  location: "Coimbatore",
  kulam: "Kongu",
  profilePhoto: "profiles/test.jpg"
};

describe("Resume an incomplete Google registration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("keeps duplicate-email rejection for unauthenticated registration", async () => {
    mocks.findOne.mockResolvedValue({ id: 5 });

    await expect(register(input)).rejects.toMatchObject({ code: "EMAIL_ALREADY_REGISTERED" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("creates a verified account within the proof-consumption transaction", async () => {
    mocks.findOne.mockResolvedValue(null);
    const created = { id: 8 };
    mocks.create.mockResolvedValue(created);
    const proof = "a".repeat(64);
    await expect(register({ ...input, emailVerificationProof: proof })).resolves.toEqual(created);
    expect(mocks.consumeProof).toHaveBeenCalledWith(input.email, proof, mocks.transaction);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ emailVerified: true, status: "PENDING" }),
      { transaction: mocks.transaction }
    );
  });

  it("creates a manual registration without an OTP proof and keeps the email unverified", async () => {
    mocks.findOne.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: 9 });
    await expect(register(input)).resolves.toEqual({ id: 9 });
    expect(mocks.consumeProof).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ emailVerified: false, status: "PENDING", signupProvider: "EXISTING_LOGIN" }),
      { transaction: mocks.transaction }
    );
  });

  it("does not create a new account when verification proof is rejected", async () => {
    mocks.findOne.mockResolvedValue(null);
    mocks.consumeProof.mockRejectedValue(Object.assign(new Error("Verify your email"), {
      code: "REGISTRATION_EMAIL_VERIFICATION_REQUIRED"
    }));
    await expect(register(input, undefined, {
      sub: "verified-sub", email: input.email, authoritativeEmail: false
    })).rejects.toMatchObject({ code: "REGISTRATION_EMAIL_VERIFICATION_REQUIRED" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("binds a verified Google subject and only skips OTP for authoritative email", async () => {
    mocks.findOne.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: 20 });
    const identity = { sub: "verified-sub", email: input.email, authoritativeEmail: true };
    await register(input, undefined, identity);
    expect(mocks.consumeProof).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      signupProvider: "GOOGLE", googleId: identity.sub, emailVerified: true, status: "PENDING"
    }), { transaction: mocks.transaction });

    await register({ ...input, emailVerificationProof: "a".repeat(64) }, undefined,
      { ...identity, authoritativeEmail: false });
    expect(mocks.consumeProof).toHaveBeenCalledWith(input.email, "a".repeat(64), mocks.transaction);
  });

  it("rejects a submitted email different from the verified Google email", async () => {
    await expect(register(input, undefined, {
      sub: "verified-sub", email: "another@example.com", authoritativeEmail: true
    })).rejects.toMatchObject({ code: "GOOGLE_EMAIL_MISMATCH" });
    expect(mocks.findOne).not.toHaveBeenCalled();
  });

  it("never alters an existing email account belonging to a different identity", async () => {
    mocks.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 19, googleId: "another-sub" });
    await expect(register(input, undefined, {
      sub: "verified-sub", email: input.email, authoritativeEmail: true
    })).rejects.toMatchObject({ code: "EMAIL_ALREADY_REGISTERED" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("reuses a pending same-subject registration after a concurrent insert without writing profile fields", async () => {
    const existing = { id: 20, signupProvider: "GOOGLE", profileComplete: true, email: input.email, status: "PENDING" };
    const identity = { sub: "verified-sub", email: input.email, authoritativeEmail: true };
    mocks.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    mocks.create.mockRejectedValueOnce({ name: "SequelizeUniqueConstraintError" });
    await expect(register(input, undefined, identity)).resolves.toEqual(existing);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it("rejects an already committed Google subject attached to a different email", async () => {
    mocks.findOne.mockResolvedValueOnce({
      id: 20, signupProvider: "GOOGLE", profileComplete: true, email: "old@example.com", status: "PENDING"
    });
    await expect(register(input, undefined, {
      sub: "verified-sub", email: input.email, authoritativeEmail: true
    })).rejects.toMatchObject({ code: "GOOGLE_ACCOUNT_EXISTS" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects resuming an email belonging to a different account", async () => {
    mocks.findOne.mockResolvedValue({ id: 6 });

    await expect(register(input, 5)).rejects.toMatchObject({ status: 400 });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("completes the same account using a conditional update", async () => {
    const resumedUser = { id: 5, profileComplete: true };
    mocks.findOne.mockResolvedValueOnce({
      id: 5,
      signupProvider: "GOOGLE",
      reload: async () => resumedUser
    }).mockResolvedValueOnce(null);
    mocks.update.mockResolvedValue([1]);

    await expect(register(input, 5)).resolves.toEqual(resumedUser);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ profileComplete: true, profilePhoto: input.profilePhoto }),
      expect.objectContaining({
        where: expect.objectContaining({
          id: 5,
          email: input.email,
          signupProvider: "GOOGLE",
          profileComplete: false
        })
      })
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("fails if the account was already completed or is no longer eligible", async () => {
    mocks.findOne.mockResolvedValueOnce({ id: 5 }).mockResolvedValueOnce(null);
    mocks.update.mockResolvedValue([0]);

    await expect(register(input, 5)).rejects.toMatchObject({ status: 409 });
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });
});
