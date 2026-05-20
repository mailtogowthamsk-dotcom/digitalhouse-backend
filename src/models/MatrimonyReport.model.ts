import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export const MATRIMONY_REPORT_STATUSES = ["PENDING", "RESOLVED", "DISMISSED"] as const;
export type MatrimonyReportStatus = (typeof MATRIMONY_REPORT_STATUSES)[number];

export class MatrimonyReport extends Model<
  InferAttributes<MatrimonyReport>,
  InferCreationAttributes<MatrimonyReport>
> {
  declare id: number;
  declare reporterId: number;
  declare reportedUserId: number;
  declare reason: string;
  declare details: string | null;
  declare status: MatrimonyReportStatus;
  declare adminRemarks: string | null;
  declare reviewedBy: string | null;
  declare reviewedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

MatrimonyReport.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    reporterId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "reporter_id" },
    reportedUserId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "reported_user_id" },
    reason: { type: DataTypes.STRING(80), allowNull: false },
    details: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.ENUM(...MATRIMONY_REPORT_STATUSES),
      allowNull: false,
      defaultValue: "PENDING"
    },
    adminRemarks: { type: DataTypes.TEXT, allowNull: true, field: "admin_remarks" },
    reviewedBy: { type: DataTypes.STRING(191), allowNull: true, field: "reviewed_by" },
    reviewedAt: { type: DataTypes.DATE, allowNull: true, field: "reviewed_at" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  {
    sequelize,
    tableName: "matrimony_reports",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at"
  }
);
