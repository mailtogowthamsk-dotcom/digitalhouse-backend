import { User } from "../models";

export type RegisterInput = {
  fullName: string;
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

  const user = await User.create({
    fullName: data.fullName.trim(),
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
    status: "PENDING"
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
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    status: user.status,
    createdAt: user.createdAt
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
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

export const userService = {
  register,
  findByEmail,
  findById,
  toSafeUser,
  toAdminUser
};
