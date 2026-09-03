import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";
import type { ReferralCodeStatus } from "../constants/referral.constants";

export class ReferralCode extends Model<InferAttributes<ReferralCode>, InferCreationAttributes<ReferralCode>> {
  declare id: number;
  declare ownerUserId: number;
  declare code: string;
  declare status: ReferralCodeStatus;
  declare createdAt: Date;
  declare updatedAt: Date;
}

ReferralCode.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    ownerUserId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    code: { type: DataTypes.STRING(16), allowNull: false },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "ACTIVE" },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  {
    sequelize,
    tableName: "referral_codes",
    timestamps: true,
    indexes: [
      { unique: true, fields: ["code"] },
      { unique: true, fields: ["ownerUserId"] },
      { fields: ["status"] }
    ]
  }
);
