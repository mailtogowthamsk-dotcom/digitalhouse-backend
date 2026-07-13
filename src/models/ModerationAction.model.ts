import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";
import {
  MODERATION_ACTIONS,
  REPORT_KINDS,
  type ModerationActionType,
  type ReportKind
} from "../constants/reports.constants";

/** Audit trail for warn / suspend / escalate / resolve actions */
export class ModerationAction extends Model<
  InferAttributes<ModerationAction>,
  InferCreationAttributes<ModerationAction>
> {
  declare id: number;
  declare action: ModerationActionType;
  declare targetUserId: number | null;
  declare reportKind: ReportKind | null;
  declare reportId: number | null;
  declare adminEmail: string;
  declare note: string | null;
  declare createdAt: Date;
}

ModerationAction.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    action: {
      type: DataTypes.ENUM(...MODERATION_ACTIONS),
      allowNull: false
    },
    targetUserId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      field: "target_user_id"
    },
    reportKind: {
      type: DataTypes.ENUM(...REPORT_KINDS),
      allowNull: true,
      field: "report_kind"
    },
    reportId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      field: "report_id"
    },
    adminEmail: {
      type: DataTypes.STRING(191),
      allowNull: false,
      field: "admin_email"
    },
    note: { type: DataTypes.TEXT, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" }
  },
  {
    sequelize,
    tableName: "moderation_actions",
    timestamps: true,
    updatedAt: false
  }
);
