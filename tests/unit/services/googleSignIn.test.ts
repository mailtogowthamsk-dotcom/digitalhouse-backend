import { beforeEach, describe, expect, it, vi } from "vitest";
import { authenticateWithGoogle, verifyGoogleIdToken } from "../../../src/services/googleAuth.service";

const mocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  create: vi.fn(),
  issueToken: vi.fn(),
  verifyIdToken: vi.fn()
}));

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken = mocks.verifyIdToken;
  }
}));
vi.mock("../../../src/models", () => ({
  User: { findOne: mocks.findOne, create: mocks.create }
}));
vi.mock("../../../src/utils/jwt.util", () => ({ signAccessToken: mocks.issueToken }));
vi.mock("../../../src/services/user.service", () => ({
  toAuthUser: (user: { id: number }) => ({ id: user.id })
}));
vi.mock("../../../src/services/authAnalytics.service", () => ({ trackAuthEvent: vi.fn() }));
vi.mock("../../../src/services/RegistrationStatus.service", () => ({
  registrationStatusService: { assertCanIssueSession: vi.fn() }
}));
vi.mock("../../../src/utils/r2Client", () => ({ toStorageKeyIfR2: vi.fn() }));

describe("Google sign-in", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id");
    mocks.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ sub: "google-id", email: "Test@gmail.com", email_verified: true })
    });
    mocks.issueToken.mockReturnValue("test-session");
  });

  it("returns a registration redirect without creating an account or issuing a session", async () => {
    mocks.findOne.mockResolvedValue(null);

    await expect(authenticateWithGoogle("google-token")).resolves.toEqual({
      registrationRequired: true,
      email: "test@gmail.com"
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.issueToken).not.toHaveBeenCalled();
  });

  it("preserves sign-in for an existing Google subject", async () => {
    const user = { id: 4, googleId: "google-id", email: "test@gmail.com",
      profileComplete: true, status: "APPROVED", update: vi.fn() };
    mocks.findOne.mockResolvedValueOnce(user);

    await expect(authenticateWithGoogle("google-token")).resolves.toMatchObject({
      accessToken: "test-session",
      user: { id: 4 },
      linkedExistingAccount: false,
      needsProfileCompletion: false
    });
    expect(mocks.findOne).toHaveBeenCalledExactlyOnceWith({ where: { googleId: "google-id" } });
    expect(mocks.issueToken).toHaveBeenCalledWith({ userId: 4 });
  });

  it("does not silently link an existing account found only by email", async () => {
    const user = { id: 4, status: "APPROVED", update: vi.fn() };
    mocks.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(user);
    await expect(authenticateWithGoogle("google-token")).rejects.toMatchObject({
      code: "GOOGLE_ACCOUNT_CONFLICT"
    });
    expect(user.update).not.toHaveBeenCalled();
    expect(mocks.issueToken).not.toHaveBeenCalled();
  });

  it.each([
    ["test@gmail.com", undefined, true, true],
    ["test@example.com", "example.com", true, true],
    ["test@example.com", undefined, true, false],
    ["test@example.com", "example.com", false, false]
  ])("uses Google email ownership rules for %s", async (email, hd, emailVerified, authoritative) => {
    mocks.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ sub: "google-id", email, hd, email_verified: emailVerified })
    });
    await expect(verifyGoogleIdToken("google-token", { allowUnverifiedEmail: true }))
      .resolves.toMatchObject({ authoritativeEmail: authoritative });
  });

  it("allows an existing incomplete Google account to authenticate for registration recovery", async () => {
    mocks.findOne.mockResolvedValue({
      id: 5,
      status: "PENDING",
      profileComplete: false,
      update: vi.fn()
    });

    await expect(authenticateWithGoogle("google-token")).resolves.toMatchObject({
      accessToken: "test-session",
      user: { id: 5 },
      needsProfileCompletion: true
    });
    expect(mocks.issueToken).toHaveBeenCalledWith({
      userId: 5, purpose: "google_registration", googleSub: "google-id"
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
