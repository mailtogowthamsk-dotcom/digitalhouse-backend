import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class PostHashtag extends Model<
  InferAttributes<PostHashtag>,
  InferCreationAttributes<PostHashtag>
> {
  declare id: number;
  declare postId: number;
  declare hashtagId: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

PostHashtag.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    postId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    hashtagId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "post_hashtags", timestamps: true }
);
