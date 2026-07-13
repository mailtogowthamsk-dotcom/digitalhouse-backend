import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class MasterDataAudit extends Model<
  InferAttributes<MasterDataAudit>,
  InferCreationAttributes<MasterDataAudit>
> {
  declare id: number;
  declare itemId: number | null;
  declare typeCode: string;
  declare action: string;
  declare beforeJson: Record<string, unknown> | null;
  declare afterJson: Record<string, unknown> | null;
  declare adminUserId: number | null;
  declare note: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

MasterDataAudit.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    itemId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    typeCode: { type: DataTypes.STRING(64), allowNull: false },
    action: { type: DataTypes.STRING(32), allowNull: false },
    beforeJson: { type: DataTypes.JSON, allowNull: true },
    afterJson: { type: DataTypes.JSON, allowNull: true },
    adminUserId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    note: { type: DataTypes.STRING(500), allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  {
    sequelize,
    tableName: "master_data_audits",
    timestamps: true,
    updatedAt: true,
    indexes: [
      { fields: ["typeCode", "createdAt"], name: "idx_mdm_audits_type_created" },
      { fields: ["itemId"], name: "idx_mdm_audits_item" }
    ]
  }
);
