import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export const REPORT_STATUSES = ["PENDING", "RESOLVED", "DISMISSED"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export class PostReport extends Model<InferAttributes<PostReport>, InferCreationAttributes<PostReport>> {
  declare id: number;
  declare reporterId: number;
  declare postId: number;
  declare reason: string;
  declare status: ReportStatus;
  declare createdAt: Date;
  declare updatedAt: Date;
}

PostReport.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    reporterId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    postId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    reason: { type: DataTypes.TEXT, allowNull: false },
    status: {
      type: DataTypes.ENUM(...REPORT_STATUSES),
      allowNull: false,
      defaultValue: "PENDING"
    },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "post_reports", timestamps: true }
);
