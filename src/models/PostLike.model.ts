import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class PostLike extends Model<InferAttributes<PostLike>, InferCreationAttributes<PostLike>> {
  declare id: number;
  declare postId: number;
  declare userId: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

PostLike.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    postId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "post_likes", timestamps: true }
);
