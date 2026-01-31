import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

/**
 * OTP linked to user_id. Used after login request for approved users only.
 * otpCode is stored hashed; expires in 5 minutes; single use.
 */
export class Otp extends Model<InferAttributes<Otp>, InferCreationAttributes<Otp>> {
  declare id: number;
  declare userId: number;
  declare otpHash: string;
  declare expiresAt: Date;
  declare isUsed: boolean;
  declare createdAt: Date;
}

Otp.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    otpHash: { type: DataTypes.STRING(128), allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    isUsed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdAt: { type: DataTypes.DATE, allowNull: false }
  },
  {
    sequelize,
    tableName: "otps",
    timestamps: true,
    updatedAt: false,
    indexes: [{ fields: ["userId"] }, { fields: ["expiresAt"] }]
  }
);
