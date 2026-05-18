import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export type MatrimonyNoteType = "REVIEW" | "WARNING" | "MODERATION" | "INTERNAL";

export class MatrimonyAdminNote extends Model<
  InferAttributes<MatrimonyAdminNote>,
  InferCreationAttributes<MatrimonyAdminNote>
> {
  declare id: number;
  declare pendingUpdateId: number;
  declare userId: number;
  declare noteType: MatrimonyNoteType;
  declare content: string;
  declare createdBy: string;
  declare createdAt: Date;
}

MatrimonyAdminNote.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    pendingUpdateId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: "pending_update_id"
    },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "user_id" },
    noteType: {
      type: DataTypes.ENUM("REVIEW", "WARNING", "MODERATION", "INTERNAL"),
      allowNull: false,
      defaultValue: "INTERNAL",
      field: "note_type"
    },
    content: { type: DataTypes.TEXT, allowNull: false },
    createdBy: { type: DataTypes.STRING(191), allowNull: false, field: "created_by" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" }
  },
  {
    sequelize,
    tableName: "matrimony_admin_notes",
    timestamps: false,
    underscored: true
  }
);
