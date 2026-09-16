import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";
import type {
  BusinessBenefitStatus,
  BusinessBenefitType
} from "../constants/businessBenefit.constants";

export class BusinessBenefit extends Model<
  InferAttributes<BusinessBenefit>,
  InferCreationAttributes<BusinessBenefit>
> {
  declare id: number;
  declare businessOwnerId: number;
  declare title: string;
  declare description: string;
  declare benefitType: BusinessBenefitType;
  declare value: string;
  declare validFrom: Date | null;
  declare validUntil: Date | null;
  declare terms: string | null;
  declare usageLimit: number | null;
  declare claimCount: number;
  declare status: BusinessBenefitStatus;
  declare adminNote: string | null;
  declare reviewedAt: Date | null;
  declare reviewedByAdmin: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

BusinessBenefit.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    businessOwnerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    title: { type: DataTypes.STRING(160), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    benefitType: { type: DataTypes.STRING(32), allowNull: false },
    value: { type: DataTypes.STRING(80), allowNull: false },
    validFrom: { type: DataTypes.DATE, allowNull: true },
    validUntil: { type: DataTypes.DATE, allowNull: true },
    terms: { type: DataTypes.TEXT, allowNull: true },
    usageLimit: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    claimCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "PENDING" },
    adminNote: { type: DataTypes.TEXT, allowNull: true },
    reviewedAt: { type: DataTypes.DATE, allowNull: true },
    reviewedByAdmin: { type: DataTypes.STRING(191), allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  {
    sequelize,
    tableName: "business_benefits",
    timestamps: true,
    indexes: [
      { fields: ["businessOwnerId"], name: "idx_business_benefits_owner" },
      { fields: ["status"], name: "idx_business_benefits_status" },
      { fields: ["validUntil"], name: "idx_business_benefits_valid_until" },
      { fields: ["businessOwnerId", "status"], name: "idx_business_benefits_owner_status" }
    ]
  }
);
