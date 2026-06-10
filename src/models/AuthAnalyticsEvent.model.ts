import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";
import type { AuthAnalyticsEventType } from "../constants/auth.constants";

export class AuthAnalyticsEvent extends Model<
  InferAttributes<AuthAnalyticsEvent>,
  InferCreationAttributes<AuthAnalyticsEvent>
> {
  declare id: number;
  declare userId: number | null;
  declare eventType: AuthAnalyticsEventType;
  declare provider: string | null;
  declare metadata: Record<string, unknown> | null;
  declare createdAt: Date;
}

AuthAnalyticsEvent.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, field: "user_id" },
    eventType: { type: DataTypes.STRING(64), allowNull: false, field: "event_type" },
    provider: { type: DataTypes.STRING(32), allowNull: true },
    metadata: { type: DataTypes.JSON, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" }
  },
  {
    sequelize,
    tableName: "auth_analytics_events",
    timestamps: false
  }
);
