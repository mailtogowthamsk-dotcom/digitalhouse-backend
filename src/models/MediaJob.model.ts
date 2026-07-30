import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model
} from "sequelize";
import { sequelize } from "../config/db";

export const MEDIA_JOB_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed"
] as const;
export type MediaJobStatus = (typeof MEDIA_JOB_STATUSES)[number];

export const MEDIA_JOB_TYPES = ["image", "video"] as const;
export type MediaJobType = (typeof MEDIA_JOB_TYPES)[number];

export class MediaJob extends Model<
  InferAttributes<MediaJob>,
  InferCreationAttributes<MediaJob>
> {
  declare id: CreationOptional<number>;
  declare mediaId: number;
  declare objectKey: string;
  declare jobType: MediaJobType;
  declare status: CreationOptional<MediaJobStatus>;
  declare retryCount: CreationOptional<number>;
  declare staleRecoveryCount: CreationOptional<number>;
  declare errorMessage: CreationOptional<string | null>;
  declare workerId: CreationOptional<string | null>;
  declare startedAt: CreationOptional<Date | null>;
  declare completedAt: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

MediaJob.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    mediaId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },
    objectKey: { type: DataTypes.STRING(500), allowNull: false },
    jobType: { type: DataTypes.ENUM(...MEDIA_JOB_TYPES), allowNull: false },
    status: {
      type: DataTypes.ENUM(...MEDIA_JOB_STATUSES),
      allowNull: false,
      defaultValue: "pending"
    },
    retryCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    staleRecoveryCount: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0
    },
    errorMessage: { type: DataTypes.TEXT, allowNull: true },
    workerId: { type: DataTypes.STRING(191), allowNull: true },
    startedAt: { type: DataTypes.DATE, allowNull: true },
    completedAt: { type: DataTypes.DATE, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  {
    sequelize,
    tableName: "media_jobs",
    timestamps: true,
    indexes: [
      { fields: ["status", "updatedAt", "createdAt"] },
      { fields: ["workerId", "status"] }
    ]
  }
);
