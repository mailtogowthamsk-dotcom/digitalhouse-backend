import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";
import type { AuthProviderCode } from "../constants/auth.constants";

/** User status: PENDING/PENDING_REVIEW = awaiting approval; CHANGES_REQUESTED = admin asked for corrections; APPROVED = app access; REJECTED = denied; SUSPENDED = moderation block */
export type UserStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "PENDING_REVIEW"
  | "SUSPENDED"
  | "CHANGES_REQUESTED";
export type ProfileVisibility = "PUBLIC" | "PRIVATE";

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: number;
  declare fullName: string;
  declare username: string | null;
  declare profileVisibility: ProfileVisibility;
  declare allowConnectionRequests: boolean;
  declare usernameChangedAt: Date | null;
  declare gender: string | null;
  declare dob: Date | null;
  declare email: string;
  declare mobile: string | null;
  declare occupation: string | null;
  declare location: string | null;
  declare community: string | null;
  declare kulam: string | null;
  declare profilePhoto: string | null;
  declare govtIdType: string | null;
  declare govtIdFile: string | null;
  declare status: UserStatus;
  declare signupProvider: AuthProviderCode;
  declare providerUserId: string | null;
  declare googleId: string | null;
  declare emailVerified: boolean;
  declare lastLoginProvider: AuthProviderCode | null;
  declare profileComplete: boolean;
  declare linkedProviders: AuthProviderCode[] | null;
  declare bloodGroup: string | null;
  declare education: string | null;
  declare jobTitle: string | null;
  declare company: string | null;
  declare workLocation: string | null;
  declare skills: string | null;
  declare city: string | null;
  declare district: string | null;
  declare communityRole: string | null;
  /** Admin remarks when requesting registration corrections / rejection copy for client. */
  declare registrationAdminRemarks: string | null;
  /** JSON array of requested correction fields: mobile | profilePhoto */
  declare registrationRequestedFields: string[] | null;
  /** Pending mobile submitted for correction — not live until admin approves. */
  declare pendingMobile: string | null;
  /** Pending profile photo URL — not live until admin approves. */
  declare pendingProfilePhoto: string | null;
  declare registrationResubmittedAt: Date | null;
  declare registrationReviewedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

User.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    fullName: { type: DataTypes.STRING(120), allowNull: false },
    username: { type: DataTypes.STRING(30), allowNull: true, unique: true },
    profileVisibility: {
      type: DataTypes.ENUM("PUBLIC", "PRIVATE"),
      allowNull: false,
      defaultValue: "PUBLIC",
      field: "profile_visibility"
    },
    allowConnectionRequests: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "allow_connection_requests"
    },
    usernameChangedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "username_changed_at"
    },
    gender: { type: DataTypes.STRING(20), allowNull: true },
    dob: { type: DataTypes.DATEONLY, allowNull: true },
    email: { type: DataTypes.STRING(191), allowNull: false, unique: true },
    mobile: { type: DataTypes.STRING(20), allowNull: true },
    occupation: { type: DataTypes.STRING(80), allowNull: true },
    location: { type: DataTypes.STRING(120), allowNull: true },
    community: { type: DataTypes.STRING(80), allowNull: true },
    kulam: { type: DataTypes.STRING(80), allowNull: true },
    profilePhoto: { type: DataTypes.STRING(500), allowNull: true },
    govtIdType: { type: DataTypes.STRING(40), allowNull: true },
    govtIdFile: { type: DataTypes.STRING(500), allowNull: true },
    status: {
      type: DataTypes.ENUM(
        "PENDING",
        "APPROVED",
        "REJECTED",
        "PENDING_REVIEW",
        "SUSPENDED",
        "CHANGES_REQUESTED"
      ),
      allowNull: false,
      defaultValue: "PENDING"
    },
    signupProvider: {
      type: DataTypes.ENUM("EXISTING_LOGIN", "GOOGLE"),
      allowNull: false,
      defaultValue: "EXISTING_LOGIN",
      field: "signup_provider"
    },
    providerUserId: { type: DataTypes.STRING(191), allowNull: true, field: "provider_user_id" },
    googleId: { type: DataTypes.STRING(191), allowNull: true, unique: true, field: "google_id" },
    emailVerified: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "email_verified"
    },
    lastLoginProvider: {
      type: DataTypes.STRING(32),
      allowNull: true,
      field: "last_login_provider"
    },
    profileComplete: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "profile_complete"
    },
    linkedProviders: { type: DataTypes.JSON, allowNull: true, field: "linked_providers" },
    bloodGroup: { type: DataTypes.STRING(10), allowNull: true },
    education: { type: DataTypes.STRING(120), allowNull: true },
    jobTitle: { type: DataTypes.STRING(80), allowNull: true },
    company: { type: DataTypes.STRING(120), allowNull: true },
    workLocation: { type: DataTypes.STRING(120), allowNull: true },
    skills: { type: DataTypes.STRING(255), allowNull: true },
    city: { type: DataTypes.STRING(80), allowNull: true },
    district: { type: DataTypes.STRING(80), allowNull: true },
    communityRole: { type: DataTypes.STRING(80), allowNull: true },
    registrationAdminRemarks: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "registration_admin_remarks"
    },
    registrationRequestedFields: {
      type: DataTypes.JSON,
      allowNull: true,
      field: "registration_requested_fields"
    },
    pendingMobile: { type: DataTypes.STRING(20), allowNull: true, field: "pending_mobile" },
    pendingProfilePhoto: {
      type: DataTypes.STRING(500),
      allowNull: true,
      field: "pending_profile_photo"
    },
    registrationResubmittedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "registration_resubmitted_at"
    },
    registrationReviewedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "registration_reviewed_at"
    },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  {
    sequelize,
    tableName: "users",
    timestamps: true,
    indexes: [
      { fields: ["status"] },
      { fields: ["createdAt"] },
      { fields: ["community"] },
      { fields: ["gender"] },
      { fields: ["email"] },
      { fields: ["mobile"] }
    ]
  }
);
