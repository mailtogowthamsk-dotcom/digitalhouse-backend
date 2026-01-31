import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class Kulam extends Model<InferAttributes<Kulam>, InferCreationAttributes<Kulam>> {
  declare id: number;
  declare name: string;
  declare sortOrder: number | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Kulam.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    sortOrder: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "kulams", timestamps: true }
);
