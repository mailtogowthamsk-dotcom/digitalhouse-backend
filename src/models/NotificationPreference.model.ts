import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class NotificationPreference extends Model<
  InferAttributes<NotificationPreference>,
  InferCreationAttributes<NotificationPreference>
> {
  declare userId: number;
  declare socialEnabled: boolean;
  declare matrimonyEnabled: boolean;
  declare messagesEnabled: boolean;
  declare communityEnabled: boolean;
  declare systemEnabled: boolean;
  declare pushEnabled: boolean;
  declare createdAt: Date;
  declare updatedAt: Date;
}

NotificationPreference.init(
  {
    userId: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, field: "user_id" },
    socialEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "social_enabled"
    },
    matrimonyEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "matrimony_enabled"
    },
    messagesEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "messages_enabled"
    },
    communityEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "community_enabled"
    },
    systemEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "system_enabled"
    },
    pushEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "push_enabled"
    },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "notification_preferences", timestamps: true, underscored: true }
);
