import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model
} from "sequelize";
import { sequelize } from "../config/db";

export class ContentSafetyScan extends Model<
  InferAttributes<ContentSafetyScan>,
  InferCreationAttributes<ContentSafetyScan>
> {
  declare id: CreationOptional<number>;
  declare postId: number | null;
  declare mediaId: number | null;
  declare jobId: number | null;
  declare mediaVersion: number;
  declare mediaType: string;
  declare model: string;
  declare modelVersion: string;
  declare policyVersion: string;
  declare status: string;
  declare category: string;
  declare confidence: number | null;
  declare decision: string;
  declare failureReason: string | null;
  declare processingTimeMs: number | null;
  declare createdAt: CreationOptional<Date>;
  declare completedAt: Date | null;
}

ContentSafetyScan.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    postId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    mediaId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    jobId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    mediaVersion: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    mediaType: { type: DataTypes.STRING(16), allowNull: false },
    model: { type: DataTypes.STRING(64), allowNull: false },
    modelVersion: { type: DataTypes.STRING(32), allowNull: false },
    policyVersion: { type: DataTypes.STRING(32), allowNull: false },
    status: { type: DataTypes.STRING(32), allowNull: false },
    category: { type: DataTypes.STRING(32), allowNull: false },
    confidence: { type: DataTypes.DECIMAL(6, 5), allowNull: true },
    decision: { type: DataTypes.STRING(32), allowNull: false },
    failureReason: { type: DataTypes.STRING(255), allowNull: true },
    processingTimeMs: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    completedAt: { type: DataTypes.DATE, allowNull: true }
  },
  { sequelize, tableName: "content_safety_scans", timestamps: false }
);

export class ContentSafetyFingerprint extends Model<
  InferAttributes<ContentSafetyFingerprint>,
  InferCreationAttributes<ContentSafetyFingerprint>
> {
  declare id: CreationOptional<number>;
  declare hash: string;
  declare algorithm: string;
  declare mediaType: string;
  declare category: string;
  declare decision: string;
  declare postId: number | null;
  declare mediaId: number | null;
  declare createdAt: CreationOptional<Date>;
}

ContentSafetyFingerprint.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    hash: { type: DataTypes.CHAR(16), allowNull: false },
    algorithm: { type: DataTypes.STRING(32), allowNull: false },
    mediaType: { type: DataTypes.STRING(16), allowNull: false },
    category: { type: DataTypes.STRING(32), allowNull: false },
    decision: { type: DataTypes.STRING(32), allowNull: false },
    postId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    mediaId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "content_safety_fingerprints", timestamps: false }
);
