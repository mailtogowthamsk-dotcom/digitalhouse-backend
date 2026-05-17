import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class FeedEngagementEvent extends Model<
  InferAttributes<FeedEngagementEvent>,
  InferCreationAttributes<FeedEngagementEvent>
> {
  declare id: number;
  declare userId: number;
  declare postId: number | null;
  declare eventType: string;
  declare meta: Record<string, unknown> | null;
  declare createdAt: Date;
}

FeedEngagementEvent.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    postId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    eventType: { type: DataTypes.STRING(40), allowNull: false },
    meta: { type: DataTypes.JSON, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "feed_engagement_events", timestamps: true, updatedAt: false }
);
