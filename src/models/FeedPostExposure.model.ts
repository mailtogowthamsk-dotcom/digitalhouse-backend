import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class FeedPostExposure extends Model<
  InferAttributes<FeedPostExposure>,
  InferCreationAttributes<FeedPostExposure>
> {
  declare userId: number;
  declare postId: number;
  declare impressionCount: number;
  declare firstSeenAt: Date;
  declare lastSeenAt: Date;
  declare createdAt: Date;
  declare updatedAt: Date;
}

FeedPostExposure.init(
  {
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, primaryKey: true },
    postId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, primaryKey: true },
    impressionCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    firstSeenAt: { type: DataTypes.DATE, allowNull: false },
    lastSeenAt: { type: DataTypes.DATE, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "feed_post_exposures", timestamps: true }
);
