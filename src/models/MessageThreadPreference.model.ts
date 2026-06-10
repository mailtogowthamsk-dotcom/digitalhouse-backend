import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class MessageThreadPreference extends Model<
  InferAttributes<MessageThreadPreference>,
  InferCreationAttributes<MessageThreadPreference>
> {
  declare id: number;
  declare userId: number;
  declare otherUserId: number;
  declare muted: boolean;
  declare archived: boolean;
  declare leftAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

MessageThreadPreference.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "user_id" },
    otherUserId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "other_user_id" },
    muted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    archived: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    leftAt: { type: DataTypes.DATE, allowNull: true, field: "left_at" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  {
    sequelize,
    tableName: "message_thread_preferences",
    timestamps: true
  }
);
