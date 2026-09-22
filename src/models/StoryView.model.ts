import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model
} from "sequelize";
import { sequelize } from "../config/db";

export class StoryView extends Model<
  InferAttributes<StoryView>,
  InferCreationAttributes<StoryView>
> {
  declare id: CreationOptional<number>;
  declare storyId: number;
  declare viewerId: number;
  declare viewedAt: Date;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

StoryView.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    storyId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    viewerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    viewedAt: { type: DataTypes.DATE(3), allowNull: false },
    createdAt: { type: DataTypes.DATE(3), allowNull: false },
    updatedAt: { type: DataTypes.DATE(3), allowNull: false }
  },
  {
    sequelize,
    tableName: "story_views",
    timestamps: true,
    underscored: false
  }
);
