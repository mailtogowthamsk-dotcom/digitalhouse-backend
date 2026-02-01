import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

/** Media file status: PENDING = awaiting admin; APPROVED = visible; REJECTED = hidden */
export const MEDIA_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const MEDIA_FILE_TYPES = ["image", "video"] as const;
export type MediaFileType = (typeof MEDIA_FILE_TYPES)[number];

/** Allowed upload modules for folder structure */
export const MEDIA_MODULES = ["profile", "posts", "jobs", "marketplace", "matrimony", "help"] as const;
export type MediaModule = (typeof MEDIA_MODULES)[number];

export class MediaFile extends Model<InferAttributes<MediaFile>, InferCreationAttributes<MediaFile>> {
  declare id: number;
  declare userId: number;
  declare module: MediaModule;
  declare fileUrl: string;
  declare fileType: MediaFileType;
  declare status: MediaStatus;
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
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "media_files", timestamps: true }
);
