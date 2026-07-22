import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class Hashtag extends Model<InferAttributes<Hashtag>, InferCreationAttributes<Hashtag>> {
  declare id: number;
  /** Normalized lowercase tag without leading # */
  declare tag: string;
  declare usageCount: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Hashtag.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    tag: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    usageCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "hashtags", timestamps: true }
);
