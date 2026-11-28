import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import { checkGoogleRegistration, getMe, register } from "../../../src/controllers/auth.controller";
import { authMiddleware, jwtAuthMiddleware, type SessionRequest } from "../../../src/middlewares/auth.middleware";
import { signAccessToken, verifyAccessToken } from "../../../src/utils/jwt.util";
import { revokeUserTokens } from "../../../src/utils/tokenRevocation";

const state = vi.hoisted(() => ({
  user: { id: 78773, status: "PENDING", googleId: "subject-1" },
  findByEmail: vi.fn(),
  findByGoogleId: vi.fn(),
  verifyGoogle: vi.fn(),
  createRegistration: vi.fn(),
  assertLegal: vi.fn()
}));
vi.mock("../../../src/models", () => ({
  User: { findByPk: async () => state.user }
}));
vi.mock("../../../src/services/user.service", () => ({
  userService: {
    toAuthUser: (user: typeof state.user) => ({ id: user.id, status: user.status }),
    findByEmail: state.findByEmail,
    findByGoogleId: state.findByGoogleId,
    register: state.createRegistration
  }
}));
vi.mock("../../../src/services/googleAuth.service", () => ({ verifyGoogleIdToken: state.verifyGoogle }));
vi.mock("../../../src/services/otp.service", () => ({}));
vi.mock("../../../src/services/registrationEmail.service", () => ({}));
vi.mock("../../../src/services/RegistrationStatus.service", () => ({}));
vi.mock("../../../src/services/Username.service", () => ({}));
vi.mock("../../../src/services/authAnalytics.service", () => ({}));
vi.mock("../../../src/services/Legal.service", () => ({
  legalService: { getAcceptanceStatus: async () => null, assertRegistrationAcceptances: state.assertLegal }
}));
vi.mock("../../../src/utils/r2Client", () => ({}));

function request(token: string) {
  return { headers: { authorization: `Bearer ${token}` } } as SessionRequest;
}

function response() {
  const mock = { set: vi.fn(), status: vi.fn(), json: vi.fn() };
  mock.status.mockReturnValue(mock);
  return { mock, res: mock as unknown as Response };
}

async function readStatus(token: string) {
  const req = request(token);
  const { mock, res } = response();
  const next = vi.fn();
  await jwtAuthMiddleware(req, res, next);
  if (next.mock.calls.length) await getMe(req, res);
  return { status: mock.status.mock.calls[0]?.[0], body: mock.json.mock.calls[0]?.[0] };
}

function googleCredential(userId = state.user.id) {
  return signAccessToken({ userId, purpose: "google_registration", googleSub: "subject-1" });
}

describe("Registration status and session handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.findByEmail.mockResolvedValue(null);
    state.findByGoogleId.mockResolvedValue(null);
    state.verifyGoogle.mockResolvedValue({ sub: "subject-1", email: "new@example.com", authoritativeEmail: false });
    state.createRegistration.mockResolvedValue(state.user);
    state.user.status = "PENDING";
    state.user.googleId = "subject-1";
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("verifies a Google selection without creating a user or issuing any session", async () => {
    const { res, mock } = response();
    const req = { body: { idToken: "verified-id-token-for-test" } } as SessionRequest;
    await checkGoogleRegistration(req, res);
    expect(mock.json).toHaveBeenCalledWith({
      ok: true, email: "new@example.com", requiresEmailOtp: true
    });
    expect(state.createRegistration).not.toHaveBeenCalled();

    state.findByGoogleId.mockResolvedValueOnce(state.user);
    await checkGoogleRegistration(req, res);
    expect(mock.status).toHaveBeenLastCalledWith(409);
    expect(state.createRegistration).not.toHaveBeenCalled();
  });

  it("issues only onboarding credentials on both normal form submissions", async () => {
    const fields = {
      fullName: "New member", username: "newmember", email: "new@example.com",
      mobile: "9876543210", fatherName: "Parent", address: "Street", location: "Coimbatore",
      kulam: "Kongu"
    };
    const manual = response();
    await register({ body: fields } as SessionRequest, manual.res);
    expect(verifyAccessToken(manual.mock.json.mock.calls[0][0].accessToken).purpose).toBe("registration");
    expect(state.createRegistration).toHaveBeenCalledWith(expect.objectContaining(fields), undefined, undefined);

    const google = response();
    await register({
      body: { ...fields, googleIdToken: "verified-id-token-for-test", emailVerificationProof: "a".repeat(64) }
    } as SessionRequest, google.res);
    expect(verifyAccessToken(google.mock.json.mock.calls[0][0].accessToken)).toMatchObject({
      purpose: "google_registration", googleSub: "subject-1"
    });
    expect(state.createRegistration).toHaveBeenLastCalledWith(
      expect.objectContaining(fields), undefined, expect.objectContaining({ sub: "subject-1", authoritativeEmail: false })
    );
  });

  it.each([["LEGAL_ACCEPTANCE_REQUIRED", 400], ["LEGAL_VERSION_STALE", 409]])(
    "returns %s so Review can reload and request consent again",
    async (code, status) => {
      state.assertLegal.mockRejectedValueOnce(Object.assign(new Error("Review the legal agreements."), { code, status }));
      const { res, mock } = response();
      await register({ body: {
        fullName: "New member", username: "newmember", email: "new@example.com",
        mobile: "9876543210", fatherName: "Parent", address: "Street", location: "Coimbatore",
        kulam: "Kongu"
      } } as SessionRequest, res);
      expect(mock.status).toHaveBeenCalledWith(status);
      expect(mock.json).toHaveBeenCalledWith(expect.objectContaining({ code }));
      expect(state.createRegistration).not.toHaveBeenCalled();
    }
  );

  it("keeps a pending credential outside protected APIs before and after approval", async () => {
    const token = googleCredential();
    for (const status of ["PENDING", "APPROVED"]) {
      state.user.status = status;
      const { res, mock } = response();
      const next = vi.fn();
      await authMiddleware(request(token), res, next);
      expect(mock.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    }
  });

  it("allows concurrent and repeated status checks to recover an approved Google session", async () => {
    const token = googleCredential();
    expect((await readStatus(token)).body.accessToken).toBeUndefined();
    state.user.status = "APPROVED";
    const results = await Promise.all([readStatus(token), readStatus(token)]);
    for (const { body } of results) {
      expect(body).toMatchObject({ registrationUpgrade: true, requiresSignIn: false });
      expect(verifyAccessToken(body.accessToken)).toMatchObject({ registrationUpgrade: true });
      expect(verifyAccessToken(body.accessToken).purpose).toBeUndefined();
      const next = vi.fn();
      await authMiddleware(request(body.accessToken), response().res, next);
      expect(next).toHaveBeenCalledOnce();
      const reopened = (await readStatus(body.accessToken)).body;
      expect(reopened.registrationUpgrade).toBe(true);
      expect(reopened.accessToken).toBeUndefined();
    }
  });

  it("requires sign-in after manual approval and never upgrades a mismatched Google subject", async () => {
    state.user.status = "APPROVED";
    const manual = signAccessToken({ userId: state.user.id, purpose: "registration" });
    expect((await readStatus(manual)).body).toMatchObject({ requiresSignIn: true, accessToken: undefined });
    state.user.googleId = "another-subject";
    expect((await readStatus(googleCredential())).body).toMatchObject({ requiresSignIn: true, accessToken: undefined });
  });

  it("never upgrades a rejected or expired waiting credential", async () => {
    state.user.status = "REJECTED";
    const rejected = await readStatus(googleCredential());
    expect(rejected.body).toMatchObject({ user: { status: "REJECTED" }, accessToken: undefined });
    vi.useFakeTimers();
    vi.stubEnv("JWT_ACCESS_EXPIRES_IN", "1s");
    const expires = googleCredential();
    vi.setSystemTime(Date.now() + 2000);
    state.user.status = "APPROVED";
    expect((await readStatus(expires)).status).toBe(401);
  });

  it("rejects an explicitly revoked Google registration credential", async () => {
    const userId = state.user.id + 1;
    const token = googleCredential(userId);
    await revokeUserTokens(userId, "admin_logout");
    state.user.status = "APPROVED";
    expect((await readStatus(token)).status).toBe(401);
  });
});
