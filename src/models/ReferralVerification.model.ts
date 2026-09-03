import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";
import type { ReferralVerificationStatus } from "../constants/referral.constants";

export class ReferralVerification extends Model<
  InferAttributes<ReferralVerification>,
  InferCreationAttributes<ReferralVerification>
> {
  declare id: number;
  declare applicantUserId: number;
  declare referrerUserId: number | null;
  declare referralCodeId: number | null;
  declare referralCodeSnapshot: string | null;
  declare status: ReferralVerificationStatus;
  declare requestedAt: Date | null;
  declare requestedByAdmin: string | null;
  declare submittedAt: Date | null;
  declare verifiedAt: Date | null;
  declare verifiedByAdmin: string | null;
  declare rejectedAt: Date | null;
  declare rejectedByAdmin: string | null;
  declare adminNotes: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

ReferralVerification.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    applicantUserId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    referrerUserId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    referralCodeId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    referralCodeSnapshot: { type: DataTypes.STRING(16), allowNull: true },
    status: { type: DataTypes.STRING(40), allowNull: false },
    requestedAt: { type: DataTypes.DATE, allowNull: true },
    requestedByAdmin: { type: DataTypes.STRING(191), allowNull: true },
    submittedAt: { type: DataTypes.DATE, allowNull: true },
    verifiedAt: { type: DataTypes.DATE, allowNull: true },
    verifiedByAdmin: { type: DataTypes.STRING(191), allowNull: true },
    rejectedAt: { type: DataTypes.DATE, allowNull: true },
    rejectedByAdmin: { type: DataTypes.STRING(191), allowNull: true },
    adminNotes: { type: DataTypes.TEXT, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  {
    sequelize,
    tableName: "referral_verifications",
    timestamps: true,
    indexes: [
      { fields: ["applicantUserId"] },
      { fields: ["referrerUserId"] },
      { fields: ["status"] },
      { fields: ["createdAt"] }
    ]
  }
);
