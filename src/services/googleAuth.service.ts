import { OAuth2Client } from "google-auth-library";
import { User } from "../models";
import { signAccessToken } from "../utils/jwt.util";
import {
  AUTH_PROVIDERS,
  AUTH_ANALYTICS_EVENTS,
  DEFAULT_APP_COMMUNITY,
  type AuthProviderCode
} from "../constants/auth.constants";
import { trackAuthEvent } from "./authAnalytics.service";
import { ensureLinkedProviders } from "../utils/authProvider.util";
import { toAuthUser } from "./user.service";
import { registrationStatusService } from "./RegistrationStatus.service";
import { toStorageKeyIfR2 } from "../utils/r2Client";

export type GoogleTokenPayload = {
  sub: string;
  email: string;
  email_verified: boolean;
  authoritativeEmail: boolean;
  name?: string;
  picture?: string;
};

function getGoogleClientIds(): string[] {
  const ids = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_WEB_CLIENT_ID,
    process.env.GOOGLE_IOS_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID
  ].filter((v): v is string => !!v && v.trim().length > 0);
  return [...new Set(ids.map((v) => v.trim()))];
}

export async function verifyGoogleIdToken(idToken: string, options?: { allowUnverifiedEmail?: boolean }): Promise<GoogleTokenPayload> {
  const audiences = getGoogleClientIds();
  if (audiences.length === 0) {
    throw Object.assign(new Error("Google Sign-In is not configured on the server."), {
      status: 503,
      code: "GOOGLE_NOT_CONFIGURED"
    });
  }

  const client = new OAuth2Client();
  let ticket;
  try {
    ticket = await client.verifyIdToken({
      idToken,
      audience: audiences
    });
  } catch (e: unknown) {
    const raw = e instanceof Error ? e.message : "Invalid Google token.";
    const audienceMismatch =
      /audience|Wrong recipient|invalid token signature|Token used too early|Token used too late/i.test(
        raw
      );
    throw Object.assign(
      new Error(
        audienceMismatch
          ? "Google token was rejected by the server (client ID / SHA-1 mismatch). Ensure PM2 has the same GOOGLE_WEB_CLIENT_ID as the preview app, and the Android OAuth client includes the EAS signing SHA-1."
          : "Invalid Google token. Please try again."
      ),
      { status: 401, code: "INVALID_GOOGLE_TOKEN", cause: raw }
    );
  }
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw Object.assign(new Error("Invalid Google token."), { status: 401, code: "INVALID_GOOGLE_TOKEN" });
  }
  if (!payload.email_verified && !options?.allowUnverifiedEmail) {
    throw Object.assign(new Error("Google email is not verified."), {
      status: 403,
      code: "GOOGLE_EMAIL_UNVERIFIED"
    });
  }

  const email = payload.email.toLowerCase().trim();
  return {
    sub: payload.sub,
    email,
    email_verified: payload.email_verified === true,
    authoritativeEmail: payload.email_verified === true && (email.endsWith("@gmail.com") || Boolean(payload.hd)),
    name: payload.name,
    picture: payload.picture
  };
}

export type GoogleAuthResult = {
  accessToken: string;
  user: ReturnType<typeof toAuthUser>;
  isNewUser: boolean;
  linkedExistingAccount: boolean;
  needsProfileCompletion: boolean;
};

export type GoogleRegistrationRequired = {
  registrationRequired: true;
  email: string;
};

export async function authenticateWithGoogle(
  idToken: string
): Promise<GoogleAuthResult | GoogleRegistrationRequired> {
  const google = await verifyGoogleIdToken(idToken, { allowUnverifiedEmail: true });

  const user = await User.findOne({ where: { googleId: google.sub } });
  if (!user) {
    if (await User.findOne({ where: { email: google.email } })) {
      throw Object.assign(new Error("This email already has an account. Sign in with email OTP."), {
        status: 409,
        code: "GOOGLE_ACCOUNT_CONFLICT"
      });
    }
    return { registrationRequired: true, email: google.email };
  }
  registrationStatusService.assertCanIssueSession(user);
  await user.update({
    emailVerified: user.emailVerified || (google.authoritativeEmail && user.email === google.email),
    lastLoginProvider: AUTH_PROVIDERS.GOOGLE,
    profilePhoto: user.profilePhoto || google.picture || null
  });
  void trackAuthEvent(AUTH_ANALYTICS_EVENTS.GOOGLE_LOGIN, { userId: user.id });

  const accessToken = ["PENDING", "PENDING_REVIEW", "CHANGES_REQUESTED"].includes(user.status)
    ? signAccessToken({ userId: user.id, purpose: "google_registration", googleSub: google.sub })
    : signAccessToken({ userId: user.id });
  const needsProfileCompletion = !user.profileComplete;

  return {
    accessToken,
    user: toAuthUser(user),
    isNewUser: false,
    linkedExistingAccount: false,
    needsProfileCompletion
  };
}

export type CompleteGoogleProfileInput = {
  username: string;
  gender: string;
  dob: string;
  district: string;
  kulam: string;
  mobile: string;
  location?: string | null;
  occupation?: string | null;
  fatherName: string;
  address: string;
  workStudyDetails?: string | null;
  profilePhoto?: string | null;
  referralCode?: string | null;
};

export async function completeGoogleProfile(
  userId: number,
  input: CompleteGoogleProfileInput
): Promise<ReturnType<typeof toAuthUser>> {
  const user = await User.findByPk(userId);
  if (!user) throw Object.assign(new Error("User not found"), { status: 404 });
  if (user.profileComplete) {
    throw Object.assign(new Error("Profile already completed"), { status: 400 });
  }

  const { assertValidMobile } = await import("../utils/mobile.util");
  const mobile = assertValidMobile(input.mobile);
  const existingMobile = await User.findOne({
    where: { mobile }
  });
  if (existingMobile && existingMobile.id !== userId) {
    throw Object.assign(new Error("An account with this mobile number already exists."), {
      status: 409
    });
  }

  const { usernameService } = await import("./Username.service");
  const username = usernameService.normalizeUsername(input.username);
  usernameService.validateUsernameFormat(username);
  if (!(await usernameService.isUsernameAvailable(username, userId))) {
    throw Object.assign(new Error("This username is already taken."), { status: 409 });
  }

  const { assertValidKulam } = await import("./kulamValidation.service");
  const kulam = await assertValidKulam(input.kulam);
  const district = String(input.district ?? "").trim();
  if (!district) {
    throw Object.assign(new Error("Please select your district."), { status: 400 });
  }
  const gender = String(input.gender ?? "").trim();
  if (!gender || !["Male", "Female", "Other"].includes(gender)) {
    throw Object.assign(new Error("Please select gender."), { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.dob ?? "").trim())) {
    throw Object.assign(new Error("Please select a valid date of birth."), { status: 400 });
  }
  const fatherName = input.fatherName.trim();
  const address = input.address.trim();
  if (!fatherName) {
    throw Object.assign(new Error("Please enter your father's name."), { status: 400 });
  }
  if (!address) {
    throw Object.assign(new Error("Please enter your address."), { status: 400 });
  }

  const referralCode = input.referralCode?.trim() || "";
  if (referralCode) {
    const { referralService } = await import("./Referral.service");
    await referralService.assertUsableReferralCode(referralCode, userId);
  }

  const [updated] = await User.update({
    username,
    usernameChangedAt: new Date(),
    gender,
    dob: new Date(input.dob),
    district,
    kulam,
    community: DEFAULT_APP_COMMUNITY,
    location: input.location?.trim() || district,
    mobile,
    occupation: input.occupation?.trim() || null,
    profilePhoto: toStorageKeyIfR2(input.profilePhoto ?? null) || user.profilePhoto,
    profileComplete: true
  }, { where: { id: userId, profileComplete: false } });
  if (!updated) {
    throw Object.assign(new Error("Profile already completed"), { status: 409 });
  }

  const { ensureUserProfile } = await import("./ensureUserProfile");
  const profile = await ensureUserProfile(userId);
  const rawCommunity = profile.community as unknown;
  let current: Record<string, unknown> = {};
  if (typeof rawCommunity === "string") {
    try {
      current = JSON.parse(rawCommunity) as Record<string, unknown>;
    } catch {
      current = {};
    }
  } else if (rawCommunity && typeof rawCommunity === "object" && !Array.isArray(rawCommunity)) {
    current = { ...(rawCommunity as Record<string, unknown>) };
  }

  const rawPersonal = profile.personal as unknown;
  let personalCurrent: Record<string, unknown> = {};
  if (typeof rawPersonal === "string") {
    try {
      personalCurrent = JSON.parse(rawPersonal) as Record<string, unknown>;
    } catch {
      personalCurrent = {};
    }
  } else if (rawPersonal && typeof rawPersonal === "object" && !Array.isArray(rawPersonal)) {
    personalCurrent = { ...(rawPersonal as Record<string, unknown>) };
  }
  const occupation = input.occupation?.trim() || null;
  const workStudyDetails = input.workStudyDetails?.trim() || null;
  personalCurrent.fatherName = fatherName;
  personalCurrent.address = address;
  if (occupation) personalCurrent.occupation = occupation;
  if (workStudyDetails) personalCurrent.workStudyDetails = workStudyDetails;

  await profile.update({
    community: { ...current, kulam },
    personal: Object.keys(personalCurrent).length ? personalCurrent : profile.personal
  } as any);

  if (referralCode) {
    const { referralService } = await import("./Referral.service");
    await referralService.attachReferralCodeAtRegistration(userId, referralCode);
  }

  await user.reload();
  void import("./registrationDesk/RegistrationNotify.service")
    .then((m) => m.enqueueRegistrationReceived(user.id))
    .catch((err) => {
      console.error(
        "[registration-notify] enqueue failed:",
        err instanceof Error ? err.message : err
      );
    });
  return toAuthUser(user);
}

export function getLinkedAccountsForUser(user: User): {
  providers: AuthProviderCode[];
  googleConnected: boolean;
  existingLoginConnected: boolean;
} {
  const providers = ensureLinkedProviders(user);
  return {
    providers,
    googleConnected: providers.includes(AUTH_PROVIDERS.GOOGLE) || !!user.googleId,
    existingLoginConnected: providers.includes(AUTH_PROVIDERS.EXISTING_LOGIN)
  };
}
