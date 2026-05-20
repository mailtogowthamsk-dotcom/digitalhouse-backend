import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class MatrimonyProfileOpen extends Model<
  InferAttributes<MatrimonyProfileOpen>,
  InferCreationAttributes<MatrimonyProfileOpen>
> {
  declare id: number;
  declare userId: number;
  declare candidateUserId: number;
  declare billingPeriod: string;
  declare createdAt: Date;
}

MatrimonyProfileOpen.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "user_id" },
    candidateUserId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: "candidate_user_id"
    },
    billingPeriod: { type: DataTypes.CHAR(7), allowNull: false, field: "billing_period" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" }
  },
  { sequelize, tableName: "matrimony_profile_opens", timestamps: false }
);
