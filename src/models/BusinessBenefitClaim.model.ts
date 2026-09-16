import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";
import type { BusinessBenefitClaimStatus } from "../constants/businessBenefit.constants";

export class BusinessBenefitClaim extends Model<
  InferAttributes<BusinessBenefitClaim>,
  InferCreationAttributes<BusinessBenefitClaim>
> {
  declare id: number;
  declare benefitId: number;
  declare businessOwnerId: number;
  declare memberId: number;
  declare claimCode: string;
  declare status: BusinessBenefitClaimStatus;
  declare claimedAt: Date;
  declare usedAt: Date | null;
  declare expiresAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

BusinessBenefitClaim.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    benefitId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    businessOwnerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    memberId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    claimCode: { type: DataTypes.STRING(32), allowNull: false },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "CLAIMED" },
    claimedAt: { type: DataTypes.DATE, allowNull: false },
    usedAt: { type: DataTypes.DATE, allowNull: true },
    expiresAt: { type: DataTypes.DATE, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  {
    sequelize,
    tableName: "business_benefit_claims",
    timestamps: true,
    indexes: [
      { unique: true, fields: ["claimCode"], name: "uq_benefit_claims_code" },
      { unique: true, fields: ["benefitId", "memberId"], name: "uq_benefit_claims_benefit_member" },
      { fields: ["benefitId"], name: "idx_benefit_claims_benefit" },
      { fields: ["memberId"], name: "idx_benefit_claims_member" },
      { fields: ["businessOwnerId"], name: "idx_benefit_claims_owner" },
      { fields: ["status"], name: "idx_benefit_claims_status" }
    ]
  }
);
