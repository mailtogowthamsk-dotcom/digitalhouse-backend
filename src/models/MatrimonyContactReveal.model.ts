import { DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../config/db";

export type ContactRevealStatus = "PENDING" | "PAID" | "FAILED" | "REFUNDED";

export class MatrimonyContactReveal extends Model<
  InferAttributes<MatrimonyContactReveal>,
  InferCreationAttributes<MatrimonyContactReveal>
> {
  declare id: number;
  declare userId: number;
  declare targetUserId: number;
  declare matchId: number | null;
  declare amountPaise: number;
  declare currency: string;
  declare status: ContactRevealStatus;
  declare paymentRef: string | null;
  declare paidAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

MatrimonyContactReveal.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "user_id" },
    targetUserId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "target_user_id" },
    matchId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, field: "match_id" },
    amountPaise: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 50000,
      field: "amount_paise"
    },
    currency: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: "INR" },
    status: {
      type: DataTypes.ENUM("PENDING", "PAID", "FAILED", "REFUNDED"),
      allowNull: false,
      defaultValue: "PENDING"
    },
    paymentRef: { type: DataTypes.STRING(128), allowNull: true, field: "payment_ref" },
    paidAt: { type: DataTypes.DATE, allowNull: true, field: "paid_at" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" }
  },
  { sequelize, tableName: "matrimony_contact_reveals", timestamps: false }
);
