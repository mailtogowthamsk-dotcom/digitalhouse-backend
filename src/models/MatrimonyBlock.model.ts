import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export class MatrimonyBlock extends Model<
  InferAttributes<MatrimonyBlock>,
  InferCreationAttributes<MatrimonyBlock>
> {
  declare id: number;
  declare userId: number;
  declare blockedUserId: number;
  declare createdAt: Date;
}

MatrimonyBlock.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "user_id" },
    blockedUserId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "blocked_user_id" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" }
  },
  {
    sequelize,
    tableName: "matrimony_blocks",
    timestamps: false
  }
);
