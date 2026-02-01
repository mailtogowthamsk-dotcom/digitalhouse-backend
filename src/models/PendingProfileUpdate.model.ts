/**
 * Pending profile updates for restricted sections (Matrimony, Business).
 * Changes are stored here until admin approves; approved data lives in user_profiles.
 */

import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export type PendingProfileUpdateStatus = "PENDING" | "APPROVED" | "REJECTED";
export type PendingProfileUpdateSection = "MATRIMONY" | "BUSINESS";

export class PendingProfileUpdate extends Model<
  InferAttributes<PendingProfileUpdate>,
  InferCreationAttributes<PendingProfileUpdate>
> {
  declare id: number;
  declare userId: number;
  declare section: PendingProfileUpdateSection;
  declare data: Record<string, unknown>;
  declare status: PendingProfileUpdateStatus;
  declare submittedAt: Date;
  declare reviewedAt: Date | null;
  declare adminRemarks: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

PendingProfileUpdate.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      references: { model: "users", key: "id" },
      onDelete: "CASCADE"
    },
    section: {
      type: DataTypes.ENUM("MATRIMONY", "BUSINESS"),
      allowNull: false
    },
    data: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    status: {
      type: DataTypes.ENUM("PENDING", "APPROVED", "REJECTED"),
      allowNull: false,
      defaultValue: "PENDING"
    },
    submittedAt: { type: DataTypes.DATE, allowNull: false },
    reviewedAt: { type: DataTypes.DATE, allowNull: true },
    adminRemarks: { type: DataTypes.TEXT, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  {
    sequelize,
    tableName: "pending_profile_updates",
    timestamps: true
  }
);
