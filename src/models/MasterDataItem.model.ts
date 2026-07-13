import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class MasterDataItem extends Model<
  InferAttributes<MasterDataItem>,
  InferCreationAttributes<MasterDataItem>
> {
  declare id: number;
  declare typeCode: string;
  declare code: string | null;
  declare label: string;
  declare parentId: number | null;
  declare sortOrder: number;
  declare isActive: boolean;
  /** Extra fields e.g. { lat, lng } — reserved for future. */
  declare metadata: Record<string, unknown> | null;
  /** Alternate spellings for backfill matching. */
  declare aliases: string[] | null;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

MasterDataItem.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    typeCode: { type: DataTypes.STRING(64), allowNull: false },
    code: { type: DataTypes.STRING(64), allowNull: true },
    label: { type: DataTypes.STRING(160), allowNull: false },
    parentId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    metadata: { type: DataTypes.JSON, allowNull: true },
    aliases: { type: DataTypes.JSON, allowNull: true },
    createdBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    updatedBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  {
    sequelize,
    tableName: "master_data_items",
    timestamps: true,
    indexes: [
      { fields: ["typeCode", "isActive", "sortOrder"], name: "idx_mdm_items_type_active" },
      { fields: ["typeCode", "parentId"], name: "idx_mdm_items_type_parent" },
      { fields: ["typeCode", "label"], name: "idx_mdm_items_type_label" },
      { unique: true, fields: ["typeCode", "code"], name: "uq_mdm_items_type_code" }
    ]
  }
);
