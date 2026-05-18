import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export type MatrimonyInterestStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "WITHDRAWN";

export class MatrimonyInterest extends Model<
  InferAttributes<MatrimonyInterest>,
  InferCreationAttributes<MatrimonyInterest>
> {
  declare id: number;
  declare fromUserId: number;
  declare toUserId: number;
  declare status: MatrimonyInterestStatus;
  declare introMessage: string | null;
  declare respondedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

MatrimonyInterest.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    fromUserId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "from_user_id" },
    toUserId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "to_user_id" },
    status: {
      type: DataTypes.ENUM("PENDING", "ACCEPTED", "DECLINED", "WITHDRAWN"),
      allowNull: false,
      defaultValue: "PENDING"
    },
    introMessage: { type: DataTypes.STRING(500), allowNull: true, field: "intro_message" },
    respondedAt: { type: DataTypes.DATE, allowNull: true, field: "responded_at" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  {
    sequelize,
    tableName: "matrimony_interests",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at"
  }
);
