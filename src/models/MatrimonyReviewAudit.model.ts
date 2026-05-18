import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class MatrimonyReviewAudit extends Model<
  InferAttributes<MatrimonyReviewAudit>,
  InferCreationAttributes<MatrimonyReviewAudit>
> {
  declare id: number;
  declare pendingUpdateId: number | null;
  declare userId: number;
  declare action: string;
  declare payload: Record<string, unknown> | null;
  declare createdBy: string;
  declare createdAt: Date;
}

MatrimonyReviewAudit.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    pendingUpdateId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      field: "pending_update_id"
    },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "user_id" },
    action: { type: DataTypes.STRING(64), allowNull: false },
    payload: { type: DataTypes.JSON, allowNull: true },
    createdBy: { type: DataTypes.STRING(191), allowNull: false, field: "created_by" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" }
  },
  {
    sequelize,
    tableName: "matrimony_review_audits",
    timestamps: false,
    underscored: true
  }
);
