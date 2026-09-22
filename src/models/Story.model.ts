import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model
} from "sequelize";
import { sequelize } from "../config/db";

export const STORY_MEDIA_TYPES = ["image", "video"] as const;
export type StoryMediaType = (typeof STORY_MEDIA_TYPES)[number];

export class Story extends Model<InferAttributes<Story>, InferCreationAttributes<Story>> {
  declare id: CreationOptional<number>;
  declare userId: number;
  declare mediaType: StoryMediaType;
  declare mediaUrl: string;
  declare caption: CreationOptional<string | null>;
  declare thumbnailUrl: CreationOptional<string | null>;
  declare durationSeconds: CreationOptional<number | null>;
  declare mimeType: CreationOptional<string | null>;
  declare fileSize: CreationOptional<number | null>;
  declare likeCount: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare expiresAt: Date;
  declare deletedAt: CreationOptional<Date | null>;
}

Story.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    mediaType: { type: DataTypes.ENUM(...STORY_MEDIA_TYPES), allowNull: false },
    mediaUrl: { type: DataTypes.STRING(2048), allowNull: false },
    caption: { type: DataTypes.STRING(120), allowNull: true },
    thumbnailUrl: { type: DataTypes.STRING(2048), allowNull: true },
    durationSeconds: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    mimeType: { type: DataTypes.STRING(128), allowNull: true },
    fileSize: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    likeCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    createdAt: { type: DataTypes.DATE(3), allowNull: false },
    expiresAt: { type: DataTypes.DATE(3), allowNull: false },
    deletedAt: { type: DataTypes.DATE(3), allowNull: true }
  },
  {
    sequelize,
    tableName: "stories",
    timestamps: true,
    updatedAt: false,
    underscored: false
  }
);
