import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export type PushPlatform = "ios" | "android" | "web";

export class PushDeviceToken extends Model<
  InferAttributes<PushDeviceToken>,
  InferCreationAttributes<PushDeviceToken>
> {
  declare id: number;
  declare userId: number;
  declare token: string;
  declare platform: PushPlatform;
  declare deviceId: string | null;
  declare appVersion: string | null;
  declare lastUsedAt: Date;
  declare createdAt: Date;
}

PushDeviceToken.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "user_id" },
    token: { type: DataTypes.STRING(512), allowNull: false },
    platform: {
      type: DataTypes.ENUM("ios", "android", "web"),
      allowNull: false,
      defaultValue: "android"
    },
    deviceId: { type: DataTypes.STRING(128), allowNull: true, field: "device_id" },
    appVersion: { type: DataTypes.STRING(32), allowNull: true, field: "app_version" },
    lastUsedAt: { type: DataTypes.DATE, allowNull: false, field: "last_used_at" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" }
  },
  { sequelize, tableName: "push_device_tokens", timestamps: true, updatedAt: false, underscored: true }
);
