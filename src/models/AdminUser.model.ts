import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

/**
 * Individual admin accounts (Phase 5).
 * Coexists with legacy ADMIN_EMAILS + ADMIN_PASSWORD whitelist login.
 */
export class AdminUser extends Model<InferAttributes<AdminUser>, InferCreationAttributes<AdminUser>> {
  declare id: number;
  declare name: string;
  declare email: string;
  declare passwordHash: string;
  declare role: string;
  declare isActive: boolean;
  declare lastLoginAt: Date | null;
  declare failedLoginCount: number;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

AdminUser.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    email: { type: DataTypes.STRING(191), allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING(255), allowNull: false, field: "password_hash" },
    role: {
      type: DataTypes.ENUM("SUPER_ADMIN", "ADMIN", "MODERATOR"),
      allowNull: false,
      defaultValue: "ADMIN"
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "is_active"
    },
    lastLoginAt: { type: DataTypes.DATE, allowNull: true, field: "last_login_at" },
    failedLoginCount: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      field: "failed_login_count"
    },
    createdBy: { type: DataTypes.STRING(191), allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.STRING(191), allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "admin_users", timestamps: true }
);
