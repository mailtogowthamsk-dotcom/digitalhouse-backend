import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

/** Audit log: which admin verified which user, when, and with what outcome/remarks */
export class AdminVerification extends Model<
  InferAttributes<AdminVerification>,
  InferCreationAttributes<AdminVerification>
> {
  declare id: number;
  declare userId: number;
  declare verifiedBy: string; // admin identifier (e.g. email or "system")
  declare verifiedAt: Date;
  declare remarks: string | null;
  declare createdAt: Date;
}

AdminVerification.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    verifiedBy: { type: DataTypes.STRING(191), allowNull: false },
    verifiedAt: { type: DataTypes.DATE, allowNull: false },
    remarks: { type: DataTypes.TEXT, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false }
  },
  {
    sequelize,
    tableName: "admin_verifications",
    timestamps: true,
    updatedAt: false,
    indexes: [{ fields: ["userId"] }]
  }
);
