import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model
} from "sequelize";
import { sequelize } from "../config/db";

/** Media file status: PENDING = awaiting admin; APPROVED = visible; REJECTED = hidden */
export const MEDIA_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const MEDIA_FILE_TYPES = ["image", "video"] as const;
export type MediaFileType = (typeof MEDIA_FILE_TYPES)[number];

/** Allowed upload modules for folder structure */
export const MEDIA_MODULES = [
  "profile",
  "posts",
  "jobs",
  "marketplace",
  "matrimony",
  "help",
  "prominent",
  "advertisements"
] as const;
export type MediaModule = (typeof MEDIA_MODULES)[number];

export const MEDIA_PROCESSING_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed"
] as const;
export type MediaProcessingStatus = (typeof MEDIA_PROCESSING_STATUSES)[number];

export class MediaFile extends Model<InferAttributes<MediaFile>, InferCreationAttributes<MediaFile>> {
  declare id: CreationOptional<number>;
  declare userId: number;
  declare module: MediaModule;
  declare fileUrl: string;
  declare fileType: MediaFileType;
  declare status: CreationOptional<MediaStatus>;
  declare objectKey: CreationOptional<string | null>;
  declare variantsJson: CreationOptional<string | null>;
  declare processingStatus: CreationOptional<MediaProcessingStatus>;
  declare byteSize: CreationOptional<number | null>;
  declare width: CreationOptional<number | null>;
  declare height: CreationOptional<number | null>;
  declare mediaVersion: CreationOptional<number>;
  declare safetyDecision: CreationOptional<string | null>;
  declare safetyCategory: CreationOptional<string | null>;
  declare perceptualHash: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

MediaFile.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    module: {
      type: DataTypes.ENUM(...MEDIA_MODULES),
      allowNull: false
    },
    fileUrl: { type: DataTypes.STRING(500), allowNull: false },
    fileType: {
      type: DataTypes.ENUM(...MEDIA_FILE_TYPES),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM(...MEDIA_STATUSES),
      allowNull: false,
      defaultValue: "PENDING"
    },
    objectKey: { type: DataTypes.STRING(500), allowNull: true },
    variantsJson: { type: DataTypes.TEXT, allowNull: true },
    processingStatus: {
      type: DataTypes.ENUM(...MEDIA_PROCESSING_STATUSES),
      allowNull: false,
      defaultValue: "pending"
    },
    byteSize: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    width: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    height: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    mediaVersion: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    safetyDecision: { type: DataTypes.STRING(32), allowNull: true },
    safetyCategory: { type: DataTypes.STRING(32), allowNull: true },
    perceptualHash: { type: DataTypes.CHAR(16), allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "media_files", timestamps: true }
);
