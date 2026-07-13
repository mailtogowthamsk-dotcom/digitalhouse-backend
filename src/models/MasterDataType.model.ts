import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class MasterDataType extends Model<
  InferAttributes<MasterDataType>,
  InferCreationAttributes<MasterDataType>
> {
  declare id: number;
  declare code: string;
  declare name: string;
  declare description: string | null;
  declare parentTypeCode: string | null;
  declare parentOptional: boolean;
  declare isSystem: boolean;
  declare createdAt: Date;
  declare updatedAt: Date;
}

MasterDataType.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    code: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    description: { type: DataTypes.STRING(500), allowNull: true },
    parentTypeCode: { type: DataTypes.STRING(64), allowNull: true },
    parentOptional: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    isSystem: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "master_data_types", timestamps: true }
);
