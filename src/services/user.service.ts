import { User } from "../models";
import { AUTH_PROVIDERS } from "../constants/auth.constants";
import { ensureLinkedProviders, resolveLoginSource } from "../utils/authProvider.util";
import { usernameService } from "./Username.service";
import { assertValidKulam } from "./kulamValidation.service";
import { ensureUserProfile } from "./ensureUserProfile";

export type RegisterInput = {
  fullName: string;
  username: string;
  gender?: string | null;
  dob?: string | null;
  email: string;
  mobile?: string | null;
  occupation?: string | null;
  location?: string | null;
  community?: string | null;
  kulam?: string | null;
  profilePhoto?: string | null;
  govtIdType?: string | null;
  govtIdFile?: string | null;
};

/** One account per email; one per mobile if provided */
export async function register(data: RegisterInput): Promise<User> {
  const email = data.email.toLowerCase().trim();

  const existingEmail = await User.findOne({ where: { email } });
  if (existingEmail) {
    throw Object.assign(new Error("This email is already registered."), {
      status: 409,
      code: "EMAIL_ALREADY_REGISTERED"
    });
  }

  if (data.mobile && data.mobile.trim()) {
    const existingMobile = await User.findOne({ where: { mobile: data.mobile.trim() } });
    if (existingMobile) {
      throw Object.assign(new Error("This mobile number is already registered."), {
        status: 409,
        code: "MOBILE_ALREADY_REGISTERED"
      });
    }
  }

  const username = usernameService.normalizeUsername(data.username);
  usernameService.validateUsernameFormat(username);
  if (!(await usernameService.isUsernameAvailable(username))) {
    throw Object.assign(new Error("This username is already taken."), {
      status: 409,
      code: "USERNAME_TAKEN"
    });
  }

  const kulam = await assertValidKulam(data.kulam);
  const location = (data.location ?? "").trim();
  if (!location) {
    throw Object.assign(new Error("Please select your location."), { status: 400 });
  }

  try {
    const user = await User.create({
      fullName: data.fullName.trim(),
      username,
      gender: data.gender?.trim() || null,
      dob: data.dob ? (data.dob as any) : null,
      email,
      mobile: data.mobile?.trim() || null,
      occupation: data.occupation?.trim() || null,
      location,
      district: location,
      community: data.community?.trim() || null,
      kulam,
      profilePhoto: data.profilePhoto?.trim() || null,
      govtIdType: data.govtIdType?.trim() || null,
      govtIdFile: data.govtIdFile?.trim() || null,
      status: "PENDING",
      signupProvider: AUTH_PROVIDERS.EXISTING_LOGIN,
      profileComplete: true,
      linkedProviders: [AUTH_PROVIDERS.EXISTING_LOGIN]
    } as any);

    // Seed community profile so Edit Profile / completion see kulam immediately.
    const profile = await ensureUserProfile(user.id);
    await profile.update({
      community: { kulam }
    } as any);

    return user;
  } catch (e: any) {
    const isDup =
      e?.name === "SequelizeUniqueConstraintError" || e?.parent?.code === "ER_DUP_ENTRY";
    if (isDup) {
      const fields = (e?.fields && typeof e.fields === "object" ? Object.keys(e.fields) : []) as string[];
      const sql = String(e?.parent?.sqlMessage ?? e?.message ?? "").toLowerCase();
      if (fields.includes("email") || sql.includes("email")) {
        throw Object.assign(new Error("This email is already registered."), {
          status: 409,
          code: "EMAIL_ALREADY_REGISTERED"
        });
      }
      if (fields.includes("mobile") || sql.includes("mobile")) {
        throw Object.assign(new Error("This mobile number is already registered."), {
          status: 409,
          code: "MOBILE_ALREADY_REGISTERED"
        });
      }
      if (fields.includes("username") || sql.includes("username")) {
        throw Object.assign(new Error("This username is already taken."), {
          status: 409,
          code: "USERNAME_TAKEN"
        });
      }
      throw Object.assign(
        new Error("This mobile number/email is already registered."),
        { status: 409, code: "ACCOUNT_ALREADY_EXISTS" }
      );
    }
    throw e;
  }
}


export async function findByEmail(email: string): Promise<User | null> {
  return User.findOne({ where: { email: email.toLowerCase().trim() } });
}

export async function findById(id: number): Promise<User | null> {
  return User.findByPk(id);
}

/** Hide sensitive fields from API responses */
export function toSafeUser(user: User) {
  return toAuthUser(user);
}

/** Auth/session user payload for mobile */
export function toAuthUser(user: User) {
  const requested = Array.isArray(user.registrationRequestedFields)
    ? user.registrationRequestedFields.filter((f) => typeof f === "string")
    : [];
  return {
    id: user.id,
    fullName: user.fullName,
    username: user.username ?? null,
    email: user.email,
    mobile: user.mobile ?? null,
    status: user.status,
    createdAt: user.createdAt,
    profileComplete: user.profileComplete !== false,
    needsUsernameSetup: user.status === "APPROVED" && !user.username,
    profileVisibility: user.profileVisibility ?? "PUBLIC",
    allowConnectionRequests: user.allowConnectionRequests !== false,
    signupProvider: user.signupProvider ?? AUTH_PROVIDERS.EXISTING_LOGIN,
    linkedProviders: ensureLinkedProviders(user),
    emailVerified: !!user.emailVerified,
    profilePhoto: user.profilePhoto ?? null,
    registrationAdminRemarks: user.registrationAdminRemarks ?? null,
    registrationRequestedFields: requested,
    pendingMobile: user.pendingMobile ?? null,
    pendingProfilePhoto: user.pendingProfilePhoto ?? null,
    community:
      typeof user.community === "string" && user.community.trim()
        ? user.community.trim()
        : null,
    kulam:
      typeof user.kulam === "string" && user.kulam.trim() ? user.kulam.trim() : null
  };
}

/** Full profile for admin only (include all fields except sensitive file content if any) */
export function toAdminUser(user: User) {
  return {
    id: user.id,
    fullName: user.fullName,
    gender: user.gender,
    dob: user.dob,
    email: user.email,
    mobile: user.mobile,
    occupation: user.occupation,
    location: user.location,
    community: user.community,
    kulam: user.kulam,
    profilePhoto: user.profilePhoto,
    govtIdType: user.govtIdType,
    govtIdFile: user.govtIdFile,
    status: user.status,
    signupProvider: user.signupProvider ?? AUTH_PROVIDERS.EXISTING_LOGIN,
    googleId: user.googleId ?? null,
    emailVerified: !!user.emailVerified,
    lastLoginProvider: user.lastLoginProvider ?? null,
    profileComplete: user.profileComplete !== false,
    linkedProviders: ensureLinkedProviders(user),
    loginSource: resolveLoginSource(user),
    registrationAdminRemarks: user.registrationAdminRemarks ?? null,
    registrationRequestedFields: Array.isArray(user.registrationRequestedFields)
      ? user.registrationRequestedFields
      : [],
    pendingMobile: user.pendingMobile ?? null,
    pendingProfilePhoto: user.pendingProfilePhoto ?? null,
    registrationResubmittedAt: user.registrationResubmittedAt
      ? user.registrationResubmittedAt.toISOString()
      : null,
    registrationReviewedAt: user.registrationReviewedAt
      ? user.registrationReviewedAt.toISOString()
      : null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

export const userService = {
  register,
  findByEmail,
  findById,
  toSafeUser,
  toAuthUser,
  toAdminUser
};
