import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";
import type { NotificationCategory } from "../constants/notification.constants";

export class Notification extends Model<
  InferAttributes<Notification>,
  InferCreationAttributes<Notification>
> {
  declare id: number;
  declare userId: number;
  declare type: string;
  declare category: NotificationCategory;
  declare title: string;
  declare body: string | null;
  declare imageUrl: string | null;
  declare actionType: string | null;
  declare actionTargetId: string | null;
  declare actorUserId: number | null;
  declare groupKey: string | null;
  declare groupCount: number;
  declare priority: number;
  declare metadata: Record<string, unknown> | null;
  declare readAt: Date | null;
  declare deletedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Notification.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    type: { type: DataTypes.STRING(64), allowNull: false, defaultValue: "SYSTEM_GENERIC" },
    category: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "SYSTEM" },
    title: { type: DataTypes.STRING(255), allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: true },
    imageUrl: { type: DataTypes.STRING(512), allowNull: true, field: "image_url" },
    actionType: { type: DataTypes.STRING(64), allowNull: true, field: "action_type" },
    actionTargetId: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: "action_target_id"
    },
    actorUserId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, field: "actor_user_id" },
    groupKey: { type: DataTypes.STRING(128), allowNull: true, field: "group_key" },
    groupCount: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
      field: "group_count"
    },
    priority: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    metadata: { type: DataTypes.JSON, allowNull: true },
    readAt: { type: DataTypes.DATE, allowNull: true },
    deletedAt: { type: DataTypes.DATE, allowNull: true, field: "deleted_at" },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "notifications", timestamps: true }
);
