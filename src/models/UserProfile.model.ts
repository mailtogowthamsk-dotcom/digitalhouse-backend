/**
 * Extended profile sections (category-based, modular).
 * Basic info lives on User; community, personal, matrimony, business, family live here as JSON.
 */

import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export type CommunitySection = {
  kulam?: string | null;
  kulaDeivam?: string | null;
  nativeVillage?: string | null;
  nativeTaluk?: string | null;
};

export type PersonalSection = {
  currentLocation?: string | null;
  occupation?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  linkedin?: string | null;
  hobbies?: string | null;
  fatherName?: string | null;
  maritalStatus?: string | null;
};

export type MatrimonySection = {
  matrimonyProfileActive?: boolean | null;
  lookingFor?: "SELF" | "SON" | "DAUGHTER" | "BROTHER" | "SISTER" | null;
  /** Bride/groom display name (required for family-managed profiles in discovery) */
  candidateName?: string | null;
  candidateAge?: number | null;
  candidateGender?: "MALE" | "FEMALE" | null;
  candidateDistrict?: string | null;
  partnerGenderPreference?: "MALE" | "FEMALE" | null;
  /** Bride/groom matrimony photo — NOT the social account profile photo */
  candidatePhotoUrl?: string | null;
  /** @deprecated Legacy alias; synced with candidatePhotoUrl */
  profilePhotoUrl?: string | null;
  /** SELF only: user opted to reuse account profile photo for matrimony */
  useAccountProfilePhoto?: boolean | null;
  candidatePhotoStatus?: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "REUPLOAD_REQUESTED" | null;
  candidatePhotos?: Array<{
    id: string;
    url: string;
    status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "REUPLOAD_REQUESTED";
    isPrimary?: boolean;
    adminRemarks?: string | null;
  }> | null;
  height?: string | null;
  complexion?: string | null;
  motherTongue?: string | null;
  aboutMe?: string | null;
  gotra?: string | null;
  /** Kulam at time of approval (from community section) */
  kulamSnapshot?: string | null;
  education?: string | null;
  occupation?: string | null;
  employer?: string | null;
  annualIncome?: string | null;
  maritalStatus?: string | null;
  rashi?: string | null;
  nakshatram?: string | null;
  dosham?: string | null;
  familyType?: string | null;
  familyStatus?: string | null;
  motherName?: string | null;
  fatherOccupation?: string | null;
  numberOfSiblings?: number | null;
  brothersCount?: number | null;
  sistersCount?: number | null;
  partnerAgeMin?: number | null;
  partnerAgeMax?: number | null;
  preferredDistrictIds?: number[] | null;
  preferredKulamIds?: number[] | null;
  partnerPreferences?: string | null;
  horoscopeDocumentUrl?: string | null;
  /** Set by admin suspend action */
  matrimonySuspended?: boolean | null;
};

export type BusinessSection = {
  businessProfileActive?: boolean | null;
  businessName?: string | null;
  businessType?: string | null;
  businessDescription?: string | null;
  businessAddress?: string | null;
  businessPhone?: string | null;
  businessWebsite?: string | null;
};

export type FamilySection = {
  familyMemberId1?: number | null;
  familyMemberId2?: number | null;
  familyMemberId3?: number | null;
  familyMemberId4?: number | null;
  familyMemberId5?: number | null;
};

export class UserProfile extends Model<InferAttributes<UserProfile>, InferCreationAttributes<UserProfile>> {
  declare id: number;
  declare userId: number;
  declare community: CommunitySection | null;
  declare personal: PersonalSection | null;
  declare matrimony: MatrimonySection | null;
  declare business: BusinessSection | null;
  declare family: FamilySection | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

UserProfile.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      unique: true,
      references: { model: "users", key: "id" },
      onDelete: "CASCADE"
    },
    community: { type: DataTypes.JSON, allowNull: true, defaultValue: {} },
    personal: { type: DataTypes.JSON, allowNull: true, defaultValue: {} },
    matrimony: { type: DataTypes.JSON, allowNull: true, defaultValue: {} },
    business: { type: DataTypes.JSON, allowNull: true, defaultValue: {} },
    family: { type: DataTypes.JSON, allowNull: true, defaultValue: {} },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "user_profiles", timestamps: true }
);
