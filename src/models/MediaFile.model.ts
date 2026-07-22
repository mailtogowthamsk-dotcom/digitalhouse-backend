import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
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
  "prominent"
] as const;
export type MediaModule = (typeof MEDIA_MODULES)[number];

export const MEDIA_PROCESSING_STATUSES = [
  "pending_upload",
  "processing",
  "ready",
  "failed"
] as const;
export type MediaProcessingStatus = (typeof MEDIA_PROCESSING_STATUSES)[number];

export class MediaFile extends Model<InferAttributes<MediaFile>, InferCreationAttributes<MediaFile>> {
  declare id: number;
  declare userId: number;
  declare module: MediaModule;
  declare fileUrl: string;
  declare fileType: MediaFileType;
  declare status: MediaStatus;
  declare objectKey: string | null;
  declare variantsJson: string | null;
  declare processingStatus: MediaProcessingStatus;
  declare byteSize: number | null;
  declare width: number | null;
  declare height: number | null;
  declare createdAt: Date;
  declare updatedAt: Date;
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
      defaultValue: "pending_upload"
    },
    byteSize: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    width: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    height: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "media_files", timestamps: true }
);
