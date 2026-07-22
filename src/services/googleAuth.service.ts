import { OAuth2Client } from "google-auth-library";
import { User } from "../models";
import { signAccessToken } from "../utils/jwt.util";
import {
  AUTH_PROVIDERS,
  AUTH_ANALYTICS_EVENTS,
  type AuthProviderCode
} from "../constants/auth.constants";
import { trackAuthEvent } from "./authAnalytics.service";
import { mergeLinkedProvider, ensureLinkedProviders } from "../utils/authProvider.util";
import { toAuthUser } from "./user.service";
import { registrationStatusService } from "./RegistrationStatus.service";

export type GoogleTokenPayload = {
  sub: string;
  email: string;
  email_verified: boolean;
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

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleTokenPayload> {
  const audiences = getGoogleClientIds();
  if (audiences.length === 0) {
    throw Object.assign(new Error("Google Sign-In is not configured on the server."), {
      status: 503,
      code: "GOOGLE_NOT_CONFIGURED"
    });
  }

  const client = new OAuth2Client();
  const ticket = await client.verifyIdToken({
    idToken,
    audience: audiences
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw Object.assign(new Error("Invalid Google token."), { status: 401, code: "INVALID_GOOGLE_TOKEN" });
  }
  if (!payload.email_verified) {
    throw Object.assign(new Error("Google email is not verified."), {
      status: 403,
      code: "GOOGLE_EMAIL_UNVERIFIED"
    });
  }

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase().trim(),
    email_verified: true,
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

export async function authenticateWithGoogle(idToken: string): Promise<GoogleAuthResult> {
  const google = await verifyGoogleIdToken(idToken);

  let user = await User.findOne({ where: { googleId: google.sub } });
  let isNewUser = false;
  let linkedExistingAccount = false;

  if (!user) {
    const byEmail = await User.findOne({ where: { email: google.email } });
    if (byEmail) {
      if (byEmail.googleId && byEmail.googleId !== google.sub) {
        throw Object.assign(
          new Error("This email is linked to a different Google account. Contact support."),
          { status: 409, code: "GOOGLE_ACCOUNT_CONFLICT" }
        );
      }
      const linked = mergeLinkedProvider(ensureLinkedProviders(byEmail), AUTH_PROVIDERS.GOOGLE);
      await byEmail.update({
        googleId: google.sub,
        providerUserId: google.sub,
        emailVerified: google.email_verified || byEmail.emailVerified,
        lastLoginProvider: AUTH_PROVIDERS.GOOGLE,
        linkedProviders: linked,
        profilePhoto: byEmail.profilePhoto || google.picture || null
      } as any);
      user = byEmail;
      linkedExistingAccount = true;
      void trackAuthEvent(AUTH_ANALYTICS_EVENTS.GOOGLE_LINKED, {
        userId: user.id,
        provider: AUTH_PROVIDERS.GOOGLE
      });
      void trackAuthEvent(AUTH_ANALYTICS_EVENTS.GOOGLE_LOGIN, {
        userId: user.id,
        provider: AUTH_PROVIDERS.GOOGLE,
        metadata: { linked: true }
      });
    } else {
      user = await User.create({
        fullName: (google.name || google.email.split("@")[0]).trim().slice(0, 120),
        email: google.email,
        gender: null,
        dob: null,
        mobile: null,
        occupation: null,
        location: null,
        community: null,
        kulam: null,
        profilePhoto: google.picture || null,
        status: "PENDING",
        signupProvider: AUTH_PROVIDERS.GOOGLE,
        providerUserId: google.sub,
        googleId: google.sub,
        emailVerified: google.email_verified,
        lastLoginProvider: AUTH_PROVIDERS.GOOGLE,
        profileComplete: false,
        linkedProviders: [AUTH_PROVIDERS.GOOGLE]
      } as any);
      isNewUser = true;
      void trackAuthEvent(AUTH_ANALYTICS_EVENTS.GOOGLE_SIGNUP, {
        userId: user.id,
        provider: AUTH_PROVIDERS.GOOGLE
      });
    }
  } else {
    await user.update({
      emailVerified: google.email_verified || user.emailVerified,
      lastLoginProvider: AUTH_PROVIDERS.GOOGLE,
      profilePhoto: user.profilePhoto || google.picture || null
    } as any);
    void trackAuthEvent(AUTH_ANALYTICS_EVENTS.GOOGLE_LOGIN, {
      userId: user.id,
      provider: AUTH_PROVIDERS.GOOGLE
    });
  }

  if (user.status === "SUSPENDED") {
    throw Object.assign(new Error("Your account has been suspended. Please contact support."), {
      status: 403,
      code: "ACCOUNT_SUSPENDED"
    });
  }

  registrationStatusService.assertCanIssueSession(user);

  // REJECTED / PENDING / CHANGES_REQUESTED still get a session so the client can
  // route to Rejected / Waiting / Correction screens. App APIs remain APPROVED-only.

  const accessToken = signAccessToken({ userId: user.id });
  const needsProfileCompletion = !user.profileComplete;

  return {
    accessToken,
    user: toAuthUser(user),
    isNewUser,
    linkedExistingAccount,
    needsProfileCompletion
  };
}

export type CompleteGoogleProfileInput = {
  username: string;
  gender: string;
  dob: string;
  district: string;
  kulam: string;
  community?: string | null;
  location?: string | null;
  mobile?: string | null;
  profilePhoto?: string | null;
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

  if (input.mobile?.trim()) {
    const existingMobile = await User.findOne({
      where: { mobile: input.mobile.trim() }
    });
    if (existingMobile && existingMobile.id !== userId) {
      throw Object.assign(new Error("An account with this mobile number already exists."), {
        status: 409
      });
    }
  }

  const { usernameService } = await import("./Username.service");
  const username = usernameService.normalizeUsername(input.username);
  usernameService.validateUsernameFormat(username);
  if (!(await usernameService.isUsernameAvailable(username, userId))) {
    throw Object.assign(new Error("This username is already taken."), { status: 409 });
  }

  const { assertValidKulam } = await import("./kulamValidation.service");
  const kulam = await assertValidKulam(input.kulam);
  const district = input.district.trim();
  if (!district) {
    throw Object.assign(new Error("Please select your district."), { status: 400 });
  }

  await user.update({
    username,
    usernameChangedAt: new Date(),
    gender: input.gender.trim(),
    dob: input.dob,
    district,
    kulam,
    community: input.community?.trim() || null,
    location: input.location?.trim() || district,
    mobile: input.mobile?.trim() || null,
    profilePhoto: input.profilePhoto?.trim() || user.profilePhoto,
    profileComplete: true
  } as any);

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
  await profile.update({
    community: { ...current, kulam }
  } as any);

  await user.reload();
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
