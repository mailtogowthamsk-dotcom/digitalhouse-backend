import { User } from "../models";
import { AUTH_PROVIDERS } from "../constants/auth.constants";
import { ensureLinkedProviders, resolveLoginSource } from "../utils/authProvider.util";
import { usernameService } from "./Username.service";

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
  if (existingEmail) throw new Error("An account with this email already exists.");

  if (data.mobile && data.mobile.trim()) {
    const existingMobile = await User.findOne({ where: { mobile: data.mobile.trim() } });
    if (existingMobile) throw new Error("An account with this mobile number already exists.");
  }

  const username = usernameService.normalizeUsername(data.username);
  usernameService.validateUsernameFormat(username);
  if (!(await usernameService.isUsernameAvailable(username))) {
    throw new Error("This username is already taken.");
  }

  const user = await User.create({
    fullName: data.fullName.trim(),
    username,
    gender: data.gender?.trim() || null,
    dob: data.dob ? (data.dob as any) : null,
    email,
    mobile: data.mobile?.trim() || null,
    occupation: data.occupation?.trim() || null,
    location: data.location?.trim() || null,
    community: data.community?.trim() || null,
    kulam: data.kulam?.trim() || null,
    profilePhoto: data.profilePhoto?.trim() || null,
    govtIdType: data.govtIdType?.trim() || null,
    govtIdFile: data.govtIdFile?.trim() || null,
    status: "PENDING",
    signupProvider: AUTH_PROVIDERS.EXISTING_LOGIN,
    profileComplete: true,
    linkedProviders: [AUTH_PROVIDERS.EXISTING_LOGIN]
  } as any);

  return user;
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
  return {
    id: user.id,
    fullName: user.fullName,
    username: user.username ?? null,
    email: user.email,
    status: user.status,
    createdAt: user.createdAt,
    profileComplete: user.profileComplete !== false,
    needsUsernameSetup: user.status === "APPROVED" && !user.username,
    profileVisibility: user.profileVisibility ?? "PUBLIC",
    allowConnectionRequests: user.allowConnectionRequests !== false,
    signupProvider: user.signupProvider ?? AUTH_PROVIDERS.EXISTING_LOGIN,
    linkedProviders: ensureLinkedProviders(user),
    emailVerified: !!user.emailVerified,
    profilePhoto: user.profilePhoto ?? null
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
