import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class Location extends Model<InferAttributes<Location>, InferCreationAttributes<Location>> {
  declare id: number;
  declare name: string;
  declare sortOrder: number | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Location.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    sortOrder: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "locations", timestamps: true }
);
