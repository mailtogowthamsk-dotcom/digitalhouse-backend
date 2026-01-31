import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class SavedPost extends Model<InferAttributes<SavedPost>, InferCreationAttributes<SavedPost>> {
  declare id: number;
  declare userId: number;
  declare postId: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

SavedPost.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    postId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "saved_posts", timestamps: true }
);
